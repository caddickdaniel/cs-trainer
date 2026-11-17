#!/usr/bin/env python3
"""Phase 15 capture benchmarks, in one CS2 session:

- grab rate: frames per second read from the CS2 window while the demo
  plays at 1x and 2x, with XGetImage and with MIT-SHM;
- kill footage: the same round's kill clips (grouped, hybrid schedule)
  recorded at 1x (the proven path) and at 2x (60 grabs/s retimed to
  normal-speed 30 fps output), with wall-clock and per-part timings, and
  every clip checked (decoded frames, distinct frames, lag, and where the
  victim's death camera starts);
- lineup still timing: the tick before release vs the setup-aware still
  tick for a standing, jump, running and run-jump throw (POV and tick are
  confirmed by CS2's log before each still).

Usage: bench15.py plan.json out_dir
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageChops, ImageStat  # noqa: E402

import bench14  # noqa: E402
import capture as cap  # noqa: E402
import launcher  # noqa: E402
import ukeys  # noqa: E402

log = bench14.log


def frames_of(webm):
    d = webm + '.frames'
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.png')) if os.path.isdir(d) else []


def biggest_change(files):
    """Index of the frame that differs most from the one before (the death
    camera switch in a victim clip)."""
    best, at, prev = -1.0, None, None
    for i, f in enumerate(files):
        im = Image.open(f).convert('L')
        if prev is not None:
            dv = ImageStat.Stat(ImageChops.difference(im, prev)).mean[0]
            if dv > best:
                best, at = dv, i
        prev = im
    return at, round(best, 2)


def grab_rate(d, seconds=3.0, ts=1.0, shm=True):
    d.use_shm = shm
    if d._shm:
        d._shm.close()
    d._shm = None
    d.cmd(f'demo_timescale {ts}')
    d.con.run('demo_resume')
    d.paused = False
    d.con.toggle()
    t0 = time.time()
    n = 0
    prev = None
    distinct = 0
    while time.time() - t0 < seconds:
        im = d.frame(320)
        n += 1
        if prev is None or ImageStat.Stat(ImageChops.difference(im.convert('L'), prev)).mean[0] > 0.5:
            distinct += 1
        prev = im.convert('L')
    rate = n / (time.time() - t0)
    d.cmd('demo_pause')
    d.cmd('demo_timescale 1')
    d.paused, d.exact = True, False
    d.use_shm = True
    return {'grabs_per_s': round(rate, 1), 'distinct_per_s': round(distinct / seconds, 1)}


def run_kills(d, plan, label, ts, out):
    steps = json.loads(json.dumps(plan['kills']).replace('/X/', f'/{label}/'))
    for st in steps:
        st['timescale'] = ts
        for o in st['outputs']:
            os.makedirs(os.path.dirname(o['file']), exist_ok=True)
    d.tick, d.paused, d.exact = None, False, False
    sums, failures = {}, []
    t0 = time.time()
    outs = []
    for st in steps:
        timer = cap.Timer()
        try:
            outs += d.record_segment(st, 64.0, timer)[0]
        except cap.CaptureError as e:
            failures.append(f'{st["player"]}: {e.code}: {e}')
            d.tick = None
        for k, v in timer.t.items():
            sums[k] = round(sums.get(k, 0) + v, 3)
    tf = time.time()
    d.finish_encoders(0)
    enc, bad = d.drain_encoded()
    flush = time.time() - tf
    wall = time.time() - t0
    checks = []
    for o in outs:
        n, distinct = bench14.probe(o['file']) if os.path.exists(o['file']) else (0, 0)
        c = {'file': os.path.relpath(o['file'], out), 'player': o['player'], 'expected': o['frames'], 'decoded': n, 'distinct': distinct,
             'lag': o['max_lag_ticks'], 'bytes': os.path.getsize(o['file']) if os.path.exists(o['file']) else 0}
        if 'victim' in o['file']:
            c['death_cam_frame'] = biggest_change(frames_of(o['file']))
        checks.append(c)
    return {
        'label': label, 'timescale': ts, 'wall_s': round(wall, 2), 'flush_s': round(flush, 2), 'timings': sums, 'failures': failures,
        'outputs': len(outs), 'encoded': len(enc), 'encode_failed': len(bad),
        'missing_frames': sum(max(0, c['expected'] - c['decoded']) for c in checks),
        'min_distinct_ratio': round(min([c['distinct'] / c['expected'] for c in checks] or [0]), 2),
        'max_lag_ticks': max([c['lag'] for c in checks] or [0]), 'checks': checks,
    }


def main():
    plan = json.load(open(sys.argv[1]))
    out = sys.argv[2]
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
        log(res, 'menu_s', round(time.time() - t0, 2))
        ukeys.focus_window(win) or ukeys.focus_window(win)
        d = cap.Driver(win, short_forward=400, timescale=1.0, paste=True, state_dir=state_dir)
        d.debug_dir = os.path.join(out, 'debug')
        os.makedirs(d.debug_dir, exist_ok=True)
        t = time.time()
        d.load_demo(plan['demo'])
        log(res, 'demo_load_s', round(time.time() - t, 2))
        d.frame(320)
        log(res, 'shm_check', {'mean_diff_vs_xgetimage': d.shm_check, 'using_shm': bool(d._shm)})

        # Grab rates while the demo plays (round 17, first kill area).
        first = plan['kills'][0]
        d.set_view(False)
        d.spectate(plan['kills'][1]['player'])
        d.seek(first['start'])
        d.hide_demo_bar()
        rates = {}
        for ts in (1.0, 2.0):
            for shm in (False, True):
                d.seek(first['start'])
                rates[f'{ts:g}x_{"shm" if shm else "xgetimage"}'] = grab_rate(d, 3.0, ts, shm)
        log(res, 'grab_rates', rates)

        # Kill footage: proven 1x path, then 2x.
        for label, ts in (('ts1', 1.0), ('ts2', 2.0)):
            r = run_kills(d, plan, label, ts, out)
            log(res, f'kills_{label}', {k: v for k, v in r.items() if k != 'checks'})
            res[f'kills_{label}_checks'] = r['checks']

        # Lineup stills: tick before release vs setup-aware still tick.
        stills = []
        d.set_view(False)
        for lu in plan['lineups']:
            row = dict(lu)
            for which in ('old_tick', 'still_tick'):
                f = os.path.join(out, f'lineup_{lu["key"].replace(":", "_")}_{which}.jpg')
                try:
                    shot = d.shot(int(lu[which]), lu['player'], f, width=0)
                    row[which + '_shot'] = {'file': os.path.basename(f), 'tick': shot['tick'], 'player': shot['player'], 'watching': d.watching, 'confirmed_tick': d.tick}
                except cap.CaptureError as e:
                    row[which + '_shot'] = {'error': f'{e.code}: {e}'}
                    d.tick = None
            stills.append(row)
        log(res, 'lineups', stills)
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
