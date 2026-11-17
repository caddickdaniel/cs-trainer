#!/usr/bin/env python3
"""Phase 13 capture benchmarks: recording speed, navigation, launch profile.

One CS2 run (capture profile: 1280x720 window, low settings, -nosound):
- launch checks: window size, null audio device (CS2 log + PipeWire streams),
  intro movie, cold start timings;
- recording speed 1x/2x/4x/8x for the same clips: wall time, output size,
  distinct frames that survive in the 30 fps output (decoded and compared),
  worst sampling lag; the clips are kept for visual checks;
- navigation: verified seek vs play-through at 8x to a nearby event;
- the same round (all its events) with the baseline (1x, seek) and with the
  candidate setting, wall-clock and failures.

Usage: bench13.py jobs.json out_dir [speeds=1,2,4,8] [candidate_ts] [candidate_nav]
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


def place(job, sub):
    j = json.loads(json.dumps(job).replace('/DIR/', f'/{sub}/'))
    for p in [j.get('clip_file'), j.get('lineup_file')] + [v.get(k) for v in (j.get('povs') or {}).values() for k in ('clip_file', 'still_file')]:
        if p:
            os.makedirs(os.path.dirname(p), exist_ok=True)
    return j


def frames_of(webm, outdir):
    """Decodes a clip to PNG frames and returns (count, distinct, size)."""
    os.makedirs(outdir, exist_ok=True)
    subprocess.run(['gst-launch-1.0', '-q', 'filesrc', f'location={webm}', '!', 'matroskademux', '!', 'vp8dec', '!', 'videoconvert', '!',
                    'pngenc', '!', 'multifilesink', f'location={outdir}/f%03d.png'], capture_output=True)
    files = sorted(f for f in os.listdir(outdir) if f.endswith('.png'))
    distinct = 0
    prev = None
    size = None
    for f in files:
        im = Image.open(os.path.join(outdir, f)).convert('L').resize((320, 180))
        size = size or Image.open(os.path.join(outdir, f)).size
        if prev is None or ImageStat.Stat(ImageChops.difference(im, prev)).mean[0] > 0.8:
            distinct += 1
        prev = im
    return len(files), distinct, size


def audio_streams():
    """PipeWire playback streams owned by cs2 (empty when muted)."""
    try:
        objs = json.loads(subprocess.run(['pw-dump'], capture_output=True, text=True, timeout=10).stdout or '[]')
    except Exception:  # noqa: BLE001
        return None
    out = []
    for o in objs:
        p = (o.get('info') or {}).get('props') or {}
        if p.get('media.class') == 'Stream/Output/Audio' and ('cs2' in str(p.get('application.process.binary', '')).lower() or 'counter' in str(p.get('application.name', '')).lower()):
            out.append(p.get('application.name'))
    return out


def run_job(d, job, res_list, label):
    t = time.time()
    try:
        r = cap.kill_event(d, job) if job['op'] == 'kill' else cap.utility_event(d, job)
        res_list.append({'event': label, 'wall_s': round(time.time() - t, 2), 'timings': r['timings']})
        return r
    except cap.CaptureError as e:
        res_list.append({'event': label, 'wall_s': round(time.time() - t, 2), 'error': f'{e.code}: {e}'})
        d.tick = None
        return None


def dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            if f.endswith(('.webm', '.jpg')):
                total += os.path.getsize(os.path.join(root, f))
    return total


def main():
    data = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    speeds = [float(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '1,2,4,8').split(',')]
    cand_ts = float(sys.argv[4]) if len(sys.argv) > 4 else None
    cand_nav = sys.argv[5] if len(sys.argv) > 5 else 'seek'
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
            time.sleep(0.2)
        lg = cap.Log(tail=20_000_000)
        lg.wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 240, 'cs2_start', 'no main menu')
        t_menu = time.time()
        time.sleep(2)
        how = None
        for _ in range(3):
            how = ukeys.focus_window(win)
            if how:
                break
            time.sleep(2)
        text = lg.read()
        log(res, 'launch', {
            'window_s': round(t_window - t0, 2), 'menu_s': round(t_menu - t0, 2), 'focused_s': round(time.time() - t0, 2), 'focus': how,
            'window_size': list(cap.xc.window_rect(win)[2:]),
            'cmdline_has_nosound': '-nosound' in launcher.cmdline(inst.pid), 'cmdline_has_novid': '-novid' in launcher.cmdline(inst.pid),
            'log_null_audio': bool(re.search(r'null device for -nosound', text)),
            'log_intro_movie': bool(re.search(r'intromovie|INTROMOVIE', text)),
            'ui_states': re.findall(r'ChangeGameUIState: (\S+) -> (\S+)', text)[:4],
            'pipewire_cs2_streams': audio_streams(),
        })
        if not how:
            raise cap.CaptureError('focus', 'could not focus CS2')
        d = cap.Driver(win, short_forward=0, timescale=1.0)
        d.debug_dir = os.path.join(out, 'debug')
        os.makedirs(d.debug_dir, exist_ok=True)
        g = []
        for _ in range(20):
            t = time.time()
            d.frame(1280)
            g.append(time.time() - t)
        log(res, 'grab_ms', round(1000 * sum(g) / len(g), 1))
        t = time.time()
        d.load_demo(data['demo'])
        log(res, 'demo_load_s', round(time.time() - t, 2))
        log(res, 'audio_after_load', audio_streams())

        only_cand = os.environ.get('BENCH_ONLY_CANDIDATE') == '1'
        # Recording speeds on the same clips.
        speed_res = {}
        for ts in ([] if only_cand or os.environ.get('BENCH_SKIP_SPEEDS') == '1' else speeds):
            d.timescale = ts
            sub = f'speed_{ts:g}x'
            per = []
            for key in ('smoke_kill', 'utility', 'flash_kill'):
                job = place(data[key]['job'], sub + '/' + key)
                r = run_job(d, job, per, key)
                if not r:
                    continue
                clips = [r['clip']] if 'clip' in r else [p['clip'] for p in r['povs'].values() if p.get('clip')]
                for c in clips:
                    n, distinct, size = frames_of(c['file'], c['file'] + '.frames')
                    per[-1].setdefault('clips', []).append({'file': os.path.relpath(c['file'], out), 'player': c['player'], 'frames': n,
                                                            'distinct_decoded': distinct, 'distinct_grabbed': c.get('distinct_frames'), 'grabs': c.get('grabs'),
                                                            'max_lag_ticks': c.get('max_lag_ticks'), 'size': size, 'bytes': os.path.getsize(c['file'])})
            speed_res[f'{ts:g}x'] = per
            log(res, f'speed_{ts:g}x', per)

        # Navigation: from the end of one clip to a nearby later clip.
        d.timescale = 1.0
        nav = {}
        rk = [x for x in data['round3'] if x['kind'] == 'kill']
        # A pair of kills with a real forward gap (later clip starts well after the first ends).
        pair = next(((x['job'], y['job']) for i, x in enumerate(rk) for y in rk[i + 1:] if y['job']['start'] - x['job']['end'] > 400), None)
        if pair and not only_cand:
            a, b = pair
            for mode in ('seek', 'play'):
                d.seek(a['end'])
                tm = cap.Timer()
                f = os.path.join(out, f'nav_{mode}.webm')
                info, kept = d.clip(b['start'], b['end'], b['povs']['killer']['player'], f, 64, timer=tm, nav=mode,
                                    grab_ticks=(b['povs']['killer']['still_tick'],))
                d.finish_encoders()
                frame = kept.get(b['povs']['killer']['still_tick'])
                if frame:
                    frame.save(os.path.join(out, f'nav_{mode}_killtick.jpg'), quality=90)
                nav[mode] = {'gap_ticks': b['start'] - a['end'], 'timings': tm.t}
            ref = os.path.join(out, 'nav_seek_killtick.jpg')
            other = os.path.join(out, 'nav_play_killtick.jpg')
            if os.path.exists(ref) and os.path.exists(other):
                nav['killtick_diff_play_vs_seek'] = round(ImageStat.Stat(ImageChops.difference(Image.open(ref).convert('L'), Image.open(other).convert('L'))).mean[0], 2)
            log(res, 'navigation', nav)

        # Same round, baseline vs candidate.
        for label, ts, navmode in ([] if only_cand else [('baseline_1x_seek', 1.0, 'seek')]) + ([(f'candidate_{cand_ts:g}x_{cand_nav}', cand_ts, cand_nav)] if cand_ts else []):
            d.timescale = ts
            per = []
            t = time.time()
            for x in data['round3']:
                job = place(x['job'], label)
                job['nav'] = navmode
                run_job(d, job, per, x['name'])
            log(res, f'round3_{label}', {'events': len(per), 'failed': sum(1 for p in per if 'error' in p), 'wall_s': round(time.time() - t, 2),
                                         'bytes': dir_size(os.path.join(os.path.dirname(out), label)),
                                         'per_event': per})
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
        json.dump(res, open(os.path.join(out, 'report.json'), 'w'), indent=1)
        print(json.dumps({'done': True}), flush=True)


if __name__ == '__main__':
    main()
