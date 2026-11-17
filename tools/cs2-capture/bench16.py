#!/usr/bin/env python3
"""Phase 16 transition benchmarks (one CS2 session), for the window-to-window
crossover points on this machine:

- console: time to open the console, submit a pasted command and see it in
  CS2's log (`echo`), and a close/open cycle;
- forward gaps (same POV, from an exact pause): overshoot-and-back vs a
  direct seek (one command up to short_forward; longer ones kept only when
  rebuilt from a full snapshot) vs fast-forward then a short seek; each
  landing frame is compared with the overshoot frame (a stale camera shows
  as a large difference). Keeping playing costs the gap itself (1x);
- backward seeks across the match (cost vs distance, and who is watched
  afterwards);
- POV switches between two live players.

Usage: bench16.py micro.json out_dir
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import ImageChops, ImageStat  # noqa: E402

import bench14  # noqa: E402
import capture as cap  # noqa: E402
import launcher  # noqa: E402
import ukeys  # noqa: E402

log = bench14.log


def gray(img):
    return img.convert('L').resize((320, 180))


def diff(a, b):
    return round(ImageStat.Stat(ImageChops.difference(a, b)).mean[0], 2)


def settled_frame(d):
    d._set_console(False)
    d.still()
    return gray(d.frame(1280))


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
        lg.wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 180, 'cs2_start', 'no main menu')
        log(res, 'menu_s', round(time.time() - t0, 2))
        time.sleep(cap.MENU_SETTLE_S)
        ukeys.focus_window(win) or ukeys.focus_window(win)
        d = cap.Driver(win, short_forward=400, timescale=1.0, paste=True, state_dir=state_dir)
        d.debug_dir = os.path.join(out, 'debug')
        os.makedirs(d.debug_dir, exist_ok=True)
        t = time.time()
        d.load_demo(plan['demo'])
        log(res, 'demo_load_s', round(time.time() - t, 2))
        d.set_view(False)
        base, who, other = plan['base'], plan['player'], plan['other']
        d.pov_at(who, base)
        d.hide_demo_bar()

        # Console: open (from closed), paste+Enter, echo seen in the log.
        rows = []
        for i in range(8):
            d._set_console(False)
            t1 = time.time()
            d._set_console(True)
            t2 = time.time()
            at = d.log.mark()
            e = d.cmd(f'echo cs16probe{i}', why='bench')
            t3 = time.time()
            try:
                d.log.wait(rf'cs16probe{i}', at, 2, 'x', 'echo not seen')
                seen = round(time.time() - t3, 3)
            except cap.CaptureError:
                seen = None  # echo output isn't always written to console.log
            rows.append({'open_s': round(t2 - t1, 3), 'submit_s': e['submit_s'], 'echo_seen_s': seen})
        if not any(r['echo_seen_s'] for r in rows):
            open(os.path.join(out, 'console_tail.txt'), 'w').write(d.log.read()[-3000:])
        log(res, 'console', {k: (round(sum(r[k] for r in rows if r[k] is not None) / max(1, sum(1 for r in rows if r[k] is not None)), 3)) for k in rows[0]} | {'samples': len(rows)})

        # Forward gaps.
        fwd = []
        for gap in plan['gaps']:
            row = {'gap_ticks': gap}
            ref = None
            for method in ('overshoot', 'direct', 'ff'):
                d.seek(base, why='bench start')
                if d.watching != who:
                    d.pov_at(who, base)
                timer = cap.Timer()
                t1 = time.time()
                if method == 'overshoot':
                    d.exact = False
                    d.seek(base + gap, timer, why='bench overshoot')
                elif method == 'direct':
                    d.seek(base + gap, timer, why='bench direct', long_forward='direct')
                else:
                    got = d.play_to(base + gap, timer)
                    d.set_timescale(1, 'bench ff restore')
                    d.seek(base + gap, timer, why='bench ff finish') if got is not None else d.seek(base + gap, timer, why='bench ff fallback')
                dt = time.time() - t1
                img = settled_frame(d)
                if method == 'overshoot':
                    ref = img
                modes = [k[5:-6] for k in timer.t if k.startswith('seek_') and k.endswith('_count')]
                row[method] = {'s': round(dt, 3), 'modes': modes, 'tick': d.tick, 'watching': d.watching, 'diff_vs_overshoot': diff(img, ref)}
            fwd.append(row)
            log(res, f'forward_{gap}', row)
        res['forward'] = fwd

        # Backward seeks across the match.
        back = []
        d.seek(plan['back_from'], why='bench back start')
        for target in plan['back_to']:
            d.seek(plan['back_from'], why='bench back start')
            t1 = time.time()
            d.seek(target, why='bench backward')
            back.append({'distance_ticks': plan['back_from'] - target, 's': round(time.time() - t1, 3), 'watching': d.watching})
        log(res, 'backward', back)

        # POV switches between two live players (then the exact seek back).
        d.seek(base, why='bench pov start')
        povs = []
        for i in range(6):
            name = other if i % 2 == 0 else who
            timer = cap.Timer()
            t1 = time.time()
            ok = d.spectate(name, timer, quick=True)
            t2 = time.time()
            d.seek(base, timer, why='bench pov reseek')
            povs.append({'to': name, 'ok': ok, 'switch_s': round(t2 - t1, 3), 'reseek_s': round(time.time() - t2, 3), 'watching': d.watching})
        log(res, 'pov', povs)
        res['trace_summary'] = {'commands': sum(1 for x in d.trace if x.get('cmd')), 'console_opens': sum(1 for x in d.trace if x.get('event') == 'console_open')}
        json.dump(d.trace, open(os.path.join(out, 'trace.json'), 'w'))
    except Exception as e:  # noqa: BLE001 - recorded in the report
        log(res, 'error', f'{type(e).__name__}: {e}')
        try:
            d.frame(1280).save(os.path.join(out, 'error.png'))
            open(os.path.join(out, 'error_log.txt'), 'w').write(d.log.read()[-6000:])
            log(res, 'focus_at_error', d.con.has_focus())
        except Exception:  # noqa: BLE001
            pass
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
