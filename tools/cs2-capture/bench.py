#!/usr/bin/env python3
"""Capture benchmarks and accuracy checks (Phase 12).

Runs real capture sessions against CS2 and reports where the time goes:
cold start (launch → window → main menu → focus), demo load, seeks (by
mode), POV switches, recording, encoding and close. It also checks:

- one-command forward seeks against the overshoot-and-back fallback
  (pixel difference of the resulting stills);
- whether a clip frame at the still's tick can replace a separate still;
- clip timing (worst frame lag) at different demo speeds;
- window size / video profile effect on grab time and per-event time.

Usage: bench.py jobs.json out_dir [variant ...]
  variants: main (1280x720, capture profile, all checks), hd (1920x1080),
            native (1280x720 with the player's own quality settings)
Jobs come from services/captures.buildJob, so they match the server's.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageChops, ImageStat  # noqa: E402

import capture as cap  # noqa: E402
import launcher  # noqa: E402
import ukeys  # noqa: E402

VARIANTS = {
    'main': {'size': (1280, 720), 'profile': 'capture'},
    'hd': {'size': (1920, 1080), 'profile': 'capture'},
    'native': {'size': (1280, 720), 'profile': 'native'},
    # The settled capture settings: 720p window, own quality, clips at 1x.
    'final': {'size': (1280, 720), 'profile': 'native'},
}


def diff(a, b):
    a = Image.open(a).convert('L') if isinstance(a, str) else a.convert('L')
    b = Image.open(b).convert('L') if isinstance(b, str) else b.convert('L')
    if a.size != b.size:
        b = b.resize(a.size)
    return round(ImageStat.Stat(ImageChops.difference(a, b)).mean[0], 2)


def place(job, out):
    """Points a job's files at this variant's folder."""
    s = json.dumps(job).replace('/DIR/', f'/{os.path.basename(out)}/')
    j = json.loads(s)
    for p in [j.get('clip_file'), j.get('lineup_file')] + [v.get(k) for v in (j.get('povs') or {}).values() for k in ('clip_file', 'still_file')]:
        if p:
            os.makedirs(os.path.dirname(p), exist_ok=True)
    return j


def log(res, key, value):
    res[key] = value
    print(json.dumps({key: value}), flush=True)


def run_variant(name, spec, data, root):
    out = os.path.join(root, name)
    os.makedirs(out, exist_ok=True)
    res = {'variant': name, **{k: list(v) if isinstance(v, tuple) else v for k, v in spec.items()}}
    state_dir = os.path.join(root, 'state')
    launcher.Instance.recover(state_dir)
    inst = launcher.Instance(state_dir)
    d = None
    saved = cap.user_convars()
    t0 = time.time()
    try:
        inst.launch(spec['profile'], spec['size'])
        t_launch = time.time()
        win = inst.wait_window()
        t_window = time.time()
        while not os.path.exists(cap.LOG):
            time.sleep(0.2)
        lg = cap.Log(tail=20_000_000)
        lg.wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 240, 'cs2_start', 'no main menu')
        time.sleep(3)
        t_menu = time.time()
        how = None
        for _ in range(3):
            how = ukeys.focus_window(win)
            if how:
                break
            time.sleep(2)
        t_focus = time.time()
        log(res, 'cold_start', {'launch': round(t_launch - t0, 2), 'window': round(t_window - t0, 2), 'menu': round(t_menu - t0, 2),
                                'focused': round(t_focus - t0, 2), 'focus_method': how})
        if not how:
            raise cap.CaptureError('focus', 'could not focus CS2')
        d = cap.Driver(win, short_forward=0, timescale=float(os.environ.get('BENCH_TIMESCALE', '0.5')))
        d.debug_dir = os.path.join(out, 'debug')
        os.makedirs(d.debug_dir, exist_ok=True)
        rect = cap.xc.window_rect(win)
        log(res, 'window_size', rect[2:] if rect else None)
        g = []
        for _ in range(15):
            t = time.time()
            d.frame(1280)
            g.append(time.time() - t)
        log(res, 'grab_ms', round(1000 * sum(g) / len(g), 1))
        t = time.time()
        d.load_demo(data['demo'])
        log(res, 'demo_load', round(time.time() - t, 2))

        jobs = data['jobs']
        if name == 'main':
            # Seek modes: overshoot (reference) vs one forward command.
            sk = jobs['smoke_kill']['job']
            T, P = sk['povs']['killer']['still_tick'], sk['povs']['killer']['player']
            d.set_view(True)
            tm = cap.Timer()
            ref = d.shot(T, P, os.path.join(out, 'seek_overshoot.jpg'), timer=tm)
            seek_res = {'overshoot_s': tm.t.get('seek')}
            for dist in (64, 200, 400, 1500):
                try:
                    d.seek(T - dist)            # backward: rebuilds from a full snapshot
                    d.short_forward = dist + 1  # allow one forward command
                    tm = cap.Timer()
                    f = os.path.join(out, f'seek_forward_{dist}.jpg')
                    d.shot(T, P, f, timer=tm)
                    seek_res[f'forward_{dist}'] = {'seek_s': tm.t.get('seek'), 'modes': {k: v for k, v in tm.t.items() if k.startswith('seek_') and k.endswith('_count')},
                                                   'diff_vs_overshoot': diff(ref['file'], f)}
                except cap.CaptureError as e:
                    seek_res[f'forward_{dist}'] = {'error': str(e)}
                    d.tick = None
            d.short_forward = 0
            log(res, 'seek_check', seek_res)

        for key in ('smoke_kill', 'flash_kill', 'utility') if name in ('main', 'final') else ('smoke_kill', 'utility'):
            job = place(jobs[key]['job'], out)
            t = time.time()
            try:
                r = cap.kill_event(d, job) if job['op'] == 'kill' else cap.utility_event(d, job)
            except cap.CaptureError as e:
                log(res, key, {'error': str(e), 'wall_s': round(time.time() - t, 2)})
                d.tick = None
                continue
            log(res, key, {'wall_s': round(time.time() - t, 2), 'timings': r['timings'],
                           'lag_ticks': [m.get('max_lag_ticks') for m in ([r.get('clip')] + [p.get('clip') for p in (r.get('povs') or {}).values()]) if m]})

        if name == 'main':
            # Still from the clip vs a separate still at the same tick/player.
            sk = place(jobs['smoke_kill']['job'], out)
            T, P = sk['povs']['killer']['still_tick'], sk['povs']['killer']['player']
            d.set_view(sk['xray'])
            info, kept = d.clip(sk['start'], sk['end'], P, os.path.join(out, 'reuse.webm'), 64, grab_ticks=(T,))
            d.finish_encoders()
            reuse = {'have_frame': T in kept}
            if T in kept:
                kept[T].save(os.path.join(out, 'reuse_frame.jpg'), quality=90)
                reuse['diff_vs_still'] = diff(kept[T], sk['povs']['killer']['still_file'])
            log(res, 'still_reuse', reuse)
            # Clip timing at other demo speeds (worst frame lag in ticks).
            uj = place(jobs['utility']['job'], out)
            for ts in (1.0, 0.75):
                d.timescale = ts
                t = time.time()
                info, _ = d.clip(uj['start'], uj['end'], uj['player'], os.path.join(out, f'utility_ts{ts}.webm'), 64)
                d.finish_encoders()
                log(res, f'timescale_{ts}', {'wall_s': round(time.time() - t, 2), 'lag_ticks': info['max_lag_ticks']})
            d.timescale = 0.5
        if name in ('main', 'final'):
            # Mixed batch on the loaded demo, in tick order.
            t = time.time()
            per = []
            for b in jobs['batch']:
                job = place(b['job'], out)
                tb = time.time()
                try:
                    r = cap.kill_event(d, job) if job['op'] == 'kill' else cap.utility_event(d, job)
                    per.append({'kind': b['kind'], 'wall_s': round(time.time() - tb, 2), 'timings': r['timings']})
                except cap.CaptureError as e:
                    per.append({'kind': b['kind'], 'wall_s': round(time.time() - tb, 2), 'error': str(e)})
                    d.tick = None
            log(res, 'batch', {'events': len(per), 'wall_s': round(time.time() - t, 2), 'per_event': per})
    except Exception as e:  # noqa: BLE001 - recorded in the report
        log(res, 'error', f'{type(e).__name__}: {e}')
    finally:
        t = time.time()
        if d:
            try:
                d.restore(saved)
            except Exception:  # noqa: BLE001
                pass
        inst.close((lambda: d.cmd('quit', settle=0)) if d else None)
        if d:
            d.close()
        log(res, 'close_s', round(time.time() - t, 2))
        log(res, 'cs2_left_running', bool(launcher.cs2_pids()))
    return res


def main():
    data = json.load(open(sys.argv[1]))
    root = sys.argv[2]
    names = sys.argv[3:] or ['main', 'hd', 'native']
    report = []
    for n in names:
        report.append(run_variant(n, VARIANTS[n], data, root))
        json.dump(report, open(os.path.join(root, 'report.json'), 'w'), indent=1)
        time.sleep(5)
    print(json.dumps({'done': True}), flush=True)


if __name__ == '__main__':
    main()
