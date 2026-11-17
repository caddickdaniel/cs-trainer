#!/usr/bin/env python3
"""Phase 14 capture benchmarks: one CS2 session, the same requested outputs
under each batch schedule (steps from services/capturePlan.js), plus:

- startup: launch, window, main menu (and whether an intro appeared; Esc
  dismisses it), focus; demo load with the readiness check;
- console input: pasted vs typed command submission, paste failures;
- seeking: one forward command (64/200/400 ticks) vs overshoot-and-back,
  compared on the rendered still; fast-forward through a gap vs seeking;
- schedules: wall-clock, per-part timings, seeks, POV switches, idle time,
  and every output checked (frame count, distinct frames, lag, encoded).

Usage: bench14.py steps.json out_dir [schedules=chronological,player,hybrid]
"""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageChops, ImageStat  # noqa: E402

import capture as cap  # noqa: E402
import launcher  # noqa: E402
import ukeys  # noqa: E402


def log(res, key, value):
    res[key] = value
    print(json.dumps({key: value}), flush=True)


def diff(a, b):
    a = Image.open(a).convert('L')
    b = Image.open(b).convert('L').resize(a.size)
    return round(ImageStat.Stat(ImageChops.difference(a, b)).mean[0], 2)


def probe(webm):
    """Frames and distinct frames in an encoded clip (decoded)."""
    d = webm + '.frames'
    os.makedirs(d, exist_ok=True)
    subprocess.run(['gst-launch-1.0', '-q', 'filesrc', f'location={webm}', '!', 'matroskademux', '!', 'vp8dec', '!', 'videoconvert', '!',
                    'videoscale', '!', 'video/x-raw,width=320,height=180', '!', 'pngenc', '!', 'multifilesink', f'location={d}/f%03d.png'], capture_output=True)
    files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
    distinct, prev = 0, None
    for f in files:
        im = Image.open(os.path.join(d, f)).convert('L')
        if prev is None or ImageStat.Stat(ImageChops.difference(im, prev)).mean[0] > 0.8:
            distinct += 1
        prev = im
    return len(files), distinct


def run_steps(d, steps, label, out, paste=True):
    d.con.paste = paste and d.con.clip is not None
    before = dict(d.con.stats)
    sums, per, failures = {}, [], []
    t0 = time.time()
    step_wall = 0.0
    for st in steps:
        timer = cap.Timer()
        ts = time.time()
        try:
            if st['op'] == 'segment':
                outs = d.record_segment(st, float(st.get('tickrate') or 64), timer)
                per.append({'op': 'segment', 'player': st['player'], 'n': len(outs), 'ticks': st['end'] - st['start'], 'wall': round(time.time() - ts, 3), 'outputs': outs})
            else:
                d.set_view(False)
                d.shot(int(st['tick']), st['player'], st['file'], width=0, timer=timer)
                per.append({'op': 'lineup', 'player': st['player'], 'wall': round(time.time() - ts, 3)})
        except cap.CaptureError as e:
            failures.append({'step': st['op'], 'player': st.get('player'), 'error': f'{e.code}: {e}'})
            d.tick = None
        step_wall += time.time() - ts
        for k, v in timer.t.items():
            sums[k] = round(sums.get(k, 0) + v, 3)
    tf = time.time()
    d.finish_encoders(0)
    enc, bad = d.drain_encoded()
    flush = time.time() - tf
    wall = time.time() - t0
    # Check every output clip.
    checks = []
    for p in per:
        for o in p.get('outputs', []):
            n, distinct = probe(o['file']) if os.path.exists(o['file']) else (0, 0)
            checks.append({'file': os.path.relpath(o['file'], out), 'expected': o['frames'], 'decoded': n, 'distinct': distinct,
                           'lag': o['max_lag_ticks'], 'bytes': os.path.getsize(o['file']) if os.path.exists(o['file']) else 0})
    after = d.con.stats
    res = {
        'schedule': label, 'paste': paste, 'wall_s': round(wall, 2), 'steps_wall_s': round(step_wall, 2), 'flush_s': round(flush, 2),
        'idle_s': round(wall - step_wall - flush, 2), 'timings': sums, 'failures': failures,
        'segments': sum(1 for p in per if p['op'] == 'segment'), 'lineups': sum(1 for p in per if p['op'] == 'lineup'),
        'outputs': len(checks), 'encoded': len(enc), 'encode_failed': len(bad),
        'missing_frames': sum(max(0, c['expected'] - c['decoded']) for c in checks),
        'low_motion_clips': sum(1 for c in checks if c['distinct'] < 0.8 * c['expected']),
        'max_lag_ticks': max([c['lag'] for c in checks] or [0]),
        'bytes': sum(c['bytes'] for c in checks),
        'commands': {k: round(after[k] - before.get(k, 0), 3) for k in after},
        'paste_failures': list(d.paste_failures),
        'checks': checks,
    }
    return res


def main():
    data = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    names = (sys.argv[3] if len(sys.argv) > 3 else 'chronological,player,hybrid').split(',')
    os.makedirs(out, exist_ok=True)
    res = {}
    state_dir = os.path.join(out, 'state')
    launcher.Instance.recover(state_dir)
    inst = launcher.Instance(state_dir)
    d = None
    saved = cap.user_convars()
    t0 = time.time()
    try:
        inst.launch('capture', (1280, 720))
        win = inst.wait_window()
        t_window = time.time()
        while not os.path.exists(cap.LOG):
            time.sleep(0.1)
        lg = cap.Log(tail=20_000_000)
        try:
            lg.wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 120, 'cs2_start', 'no main menu')
        except cap.CaptureError:
            inst.close()
            inst = launcher.Instance(state_dir)
            inst.launch('capture', (1280, 720))
            win = inst.wait_window()
            while not os.path.exists(cap.LOG):
                time.sleep(0.1)
            lg = cap.Log(tail=20_000_000)
            lg.wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 180, 'cs2_start', 'no main menu after retry')
            res['startup_retried'] = True
        t_menu = time.time()
        text = lg.read()
        intro = bool(re.search(r'intromovie|INTROMOVIE|Movie_Playing', text, re.I)) and 'MAINMENU' not in text
        how = ukeys.focus_window(win) or ukeys.focus_window(win)
        t_focus = time.time()
        d = cap.Driver(win, short_forward=400, timescale=1.0, paste=True, state_dir=state_dir)
        if intro:
            d.con.key(1)  # Esc dismisses an intro movie
        d.debug_dir = os.path.join(out, 'debug')
        os.makedirs(d.debug_dir, exist_ok=True)
        log(res, 'startup', {'window_s': round(t_window - t0, 2), 'menu_s': round(t_menu - t0, 2), 'focused_s': round(t_focus - t0, 2), 'focus': how,
                             'novid': '-novid' in launcher.cmdline(inst.pid), 'intro_seen': intro,
                             'clipboard_saved': d.con.saved_clipboard is not None})
        t = time.time()
        d.load_demo(data['demo'])
        log(res, 'demo_load_s', round(time.time() - t, 2))
        log(res, 'paste_after_load', {'stats': dict(d.con.stats), 'failures': list(d.paste_failures)})

        # Seeks: one forward command vs overshoot-and-back (no smoke here).
        kill_seg = next(s for s in data['schedules']['chronological'] if s['op'] == 'segment')
        T = kill_seg['start'] + 64
        P = kill_seg['player']
        tm = cap.Timer()
        ref = d.shot(T, P, os.path.join(out, 'seek_ref.jpg'), timer=tm)
        seeks = {'overshoot_s': tm.t.get('seek')}
        for dist in (64, 200, 400):
            d.seek(T - dist)
            d.short_forward = dist + 1
            tm = cap.Timer()
            f = os.path.join(out, f'seek_fwd_{dist}.jpg')
            try:
                d.shot(T, P, f, timer=tm)
                seeks[f'forward_{dist}'] = {'seek_s': tm.t.get('seek'), 'diff': diff(ref['file'], f), 'modes': {k: v for k, v in tm.t.items() if k.endswith('_count')}}
            except cap.CaptureError as e:
                seeks[f'forward_{dist}'] = {'error': str(e)}
                d.tick = None
        d.short_forward = 400
        # Fast-forward through a gap (8x, clock-timed) vs seeking to it.
        d.seek(T)
        gap = 600
        t1 = time.time()
        d.cmd('demo_timescale 8')
        d.con.run('demo_resume')
        time.sleep(max(0, (gap - 64) / 64 / 8))
        d.cmd('demo_pause')
        d.cmd('demo_timescale 1')
        ff_s = time.time() - t1
        d.tick, d.paused, d.exact = T, True, False  # paused somewhere after T: a seek is still needed for an exact start
        t2 = time.time()
        d.seek(T + gap)
        seeks['gap_600'] = {'fast_forward_s': round(ff_s, 3), 'then_seek_s': round(time.time() - t2, 3)}
        t3 = time.time()
        d.seek(T)
        d.seek(T + gap)
        seeks['gap_600']['seek_only_s'] = round((time.time() - t3) / 2, 3)
        log(res, 'seeks', seeks)

        # Schedules: same outputs each time (files under the schedule's folder).
        runs = []
        for name in names:
            label, paste = (name[:-6], False) if name.endswith('-typed') else (name, True)
            # -nosettle: no wait for CS2's resync after a POV change (detection only).
            d.pov_settle_s = 0 if label.endswith('-nosettle') else 1.6
            label = label.replace('-nosettle', '')
            steps = json.loads(json.dumps(data['schedules'][label]).replace(f'/b14/{label}/', f'/b14/{name}/'))
            for st in steps:
                for f in [st.get('file')] + [o['file'] for o in st.get('outputs', [])]:
                    if f:
                        os.makedirs(os.path.dirname(f), exist_ok=True)
            r = run_steps(d, steps, name, out, paste=paste)
            runs.append(r)
            log(res, f'schedule_{name}', {k: v for k, v in r.items() if k != 'checks'})
        res['runs'] = runs
    except Exception as e:  # noqa: BLE001 - recorded in the report
        log(res, 'error', f'{type(e).__name__}: {e}')
    finally:
        import signal
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        t = time.time()
        if d:
            try:
                d.restore(saved)
            except Exception:  # noqa: BLE001
                pass
        inst.close((lambda: d.cmd('quit')) if d else None)
        if d:
            d.close()
        log(res, 'close_s', round(time.time() - t, 2))
        log(res, 'cs2_left_running', bool(launcher.cs2_pids()))
        json.dump(res, open(os.path.join(out, 'report.json'), 'w'), indent=1)
        print(json.dumps({'done': True}), flush=True)


if __name__ == '__main__':
    main()
