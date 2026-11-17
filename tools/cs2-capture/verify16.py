#!/usr/bin/env python3
"""Checks captured media from a bench-capture-session report (Phase 16):
every clip decoded (frames and distinct frames vs expected) and every still
readable at full size. Decoding runs in parallel; frames go to a temp dir.

Usage: verify16.py report.json storage_dir out.json
"""
import json
import os
import subprocess
import sys
import tempfile
from multiprocessing import Pool

from PIL import Image, ImageChops, ImageStat


def probe(job):
    path, expected = job
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['gst-launch-1.0', '-q', 'filesrc', f'location={path}', '!', 'matroskademux', '!', 'vp8dec', '!', 'videoconvert', '!',
                        'videoscale', '!', 'video/x-raw,width=320,height=180', '!', 'pngenc', '!', 'multifilesink', f'location={d}/f%04d.png'],
                       capture_output=True)
        files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
        distinct, prev = 0, None
        for f in files:
            im = Image.open(os.path.join(d, f)).convert('L')
            if prev is None or ImageStat.Stat(ImageChops.difference(im, prev)).mean[0] > 0.8:
                distinct += 1
            prev = im
    return {'file': path, 'expected': expected, 'decoded': len(files), 'distinct': distinct}


def main():
    rep = json.load(open(sys.argv[1]))
    root = sys.argv[2]
    clips, stills = [], []
    seen = set()
    for c in rep['captures']:
        if c['status'] != 'ready':
            continue
        for m in c['media'] or []:
            p = os.path.join(root, str(rep.get('demo_id', 5)), str(c['capture_id']), str(m.get('attempt') or 0), m['file'])
            if m['type'] == 'video':
                key = (m.get('segment') and tuple(m['segment']), m['player'], m['start'], m['end'])
                if key in seen:
                    continue  # a grouped clip linked into several captures: check once
                seen.add(key)
                clips.append((p, m.get('frames', 0)))
            else:
                stills.append(p)
    with Pool(8) as pool:
        res = pool.map(probe, clips)
    bad_stills = []
    for p in stills:
        try:
            im = Image.open(p)
            if im.size != (1280, 720):
                bad_stills.append({'file': p, 'size': im.size})
        except Exception as e:  # noqa: BLE001
            bad_stills.append({'file': p, 'error': str(e)})
    short = [r for r in res if r['decoded'] < r['expected']]
    ratios = [r['distinct'] / r['expected'] for r in res if r['expected']]
    out = {'clips': len(res), 'stills': len(stills), 'missing_frames': sum(r['expected'] - r['decoded'] for r in short), 'short_clips': short[:20],
           'min_distinct_ratio': round(min(ratios), 3) if ratios else None, 'low_motion_clips': sum(1 for x in ratios if x < 0.5),
           'bad_stills': bad_stills}
    json.dump({'summary': out, 'clips': res}, open(sys.argv[3], 'w'), indent=1)
    print(json.dumps(out))


if __name__ == '__main__':
    main()
