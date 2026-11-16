#!/usr/bin/env python3
"""CS2 demo capture driver for the Replay Inspector (Phase 11).

Drives a running CS2 client (started with -condebug -console, window
focused) to play a demo and records real first-person frames from it:

- control: console commands typed through a uinput virtual keyboard
  (ukeys.py), only while the CS2 window has input focus;
- confirmation: every step is checked against the game's own console log
  (demo loaded, seek finished at the exact tick, which player is watched)
  or its pixels (console open/closed, playback paused);
- capture: the CS2 window's pixels read through XWayland (xgrab.py); clips
  are frames sampled while the demo plays at reduced speed, encoded to WebM
  with GStreamer (VP8).

Nothing is drawn or synthesised: an item either holds pixels CS2 rendered
for that tick and player, or fails with a reason.

Usage:
  capture.py status          JSON readiness report
  capture.py run < job.json  runs a job, prints one JSON result line

Job: {"demo": "/abs/x.dem", "tickrate": 64, "state": "/abs/state.json",
      "items": [{"type": "shot", "tick": 14132, "player": "magixx", "file": "/abs/k.jpg", "width": 1280},
                {"type": "clip", "start": 100, "end": 228, "player": "x", "file": "/abs/u.webm", "fps": 30}]}
Player names are matched against the names CS2 logs; names that can't be
typed safely are reached by cycling spectator targets instead.
"""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import ImageChops, ImageStat  # noqa: E402

import xconsole as xc  # noqa: E402

GAME = os.path.expanduser('~/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo')
LOG = os.path.join(GAME, 'console.log')
SAFE_NAME = re.compile(r'^[A-Za-z0-9 _.\-]{1,32}$')
SAFE_PATH = re.compile(r'^/[A-Za-z0-9 _./\-]+\.dem$')
# Convars changed while capturing (spectator X-ray off: it outlines players
# through walls, which the player didn't see; HUD reduced to crosshair and
# kill feed, which hides the demo playback bar), restored afterwards.
VIEW = {'spec_show_xray': '0', 'cl_draw_only_deathnotices': '1'}
DEFAULTS = {'spec_show_xray': '1', 'cl_draw_only_deathnotices': '0'}
CLIP_TIMESCALE = 0.2
PREROLL_TICKS = 32


class CaptureError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def cs2_pid():
    out = subprocess.run(['pgrep', '-x', 'cs2'], capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


def uinput_ok():
    return os.access('/dev/uinput', os.W_OK)


def status():
    pid = cs2_pid()
    win = xc.find_cs2() if pid else None
    focused = False
    if win:
        f = xc.focused()
        focused = f == win or f in xc.descendants(win)
    log_live = os.path.exists(LOG) and pid is not None and os.path.getmtime(LOG) >= _proc_start(pid)
    return {'cs2_running': pid is not None, 'window': bool(win), 'focused': focused,
            'console_log': log_live, 'uinput': uinput_ok()}


def _proc_start(pid):
    try:
        return os.path.getmtime(f'/proc/{pid}')
    except OSError:
        return 0


def user_convars():
    """The player's saved values for the convars this changes (defaults if unset)."""
    vals = dict(DEFAULTS)
    root = os.path.expanduser('~/.local/share/Steam/userdata')
    try:
        for uid in os.listdir(root):
            p = os.path.join(root, uid, '730/local/cfg/cs2_user_convars_0_slot0.vcfg')
            if os.path.exists(p):
                text = open(p, encoding='utf-8', errors='replace').read()
                for k in vals:
                    m = re.search(rf'"{k}"\s+"([^"]*)"', text)
                    if m:
                        vals[k] = m.group(1)
    except OSError:
        pass
    return vals


class Log:
    """Tails console.log (-condebug) from the moment it's created."""

    def __init__(self):
        # Start with the recent tail so the current state (last seek, watched
        # player) is known; waits only look at text after their mark.
        self.pos = max(0, os.path.getsize(LOG) - 4_000_000)
        self.text = ''
        self.read()

    def read(self):
        size = os.path.getsize(LOG)
        if size < self.pos:
            self.pos = 0
        if size > self.pos:
            with open(LOG, 'rb') as f:
                f.seek(self.pos)
                chunk = f.read(size - self.pos)
            self.pos = size
            # Drop the per-packet noise lines; keep the rest.
            self.text += '\n'.join(l for l in chunk.decode('utf-8', 'replace').splitlines() if 'CSVCMsg_UserCommands' not in l) + '\n'
        return self.text

    def mark(self):
        self.read()
        return len(self.text)

    def wait(self, pattern, since, timeout, code, message):
        rx = re.compile(pattern)
        end = time.time() + timeout
        while True:
            m = rx.search(self.read(), since)
            if m:
                return m
            if time.time() > end:
                raise CaptureError(code, message)
            time.sleep(0.15)

    def last(self, pattern):
        ms = list(re.finditer(pattern, self.read()))
        return ms[-1] if ms else None


class Driver:
    def __init__(self, focus_wait=0):
        import ukeys
        import xgrab
        self.xgrab = xgrab
        self.ukeys = ukeys
        if not cs2_pid():
            raise CaptureError('cs2_not_running', 'CS2 is not running.')
        self.win = xc.find_cs2()
        if not self.win:
            raise CaptureError('cs2_not_running', 'The CS2 window was not found.')
        if not os.path.exists(LOG):
            raise CaptureError('no_console_log', 'CS2 must be started with -condebug so each step can be confirmed.')
        self.log = Log()
        self.con = ukeys.Console()
        if not self.con.wait_focus(focus_wait):
            self.con.close()
            raise CaptureError('not_focused', 'CS2 does not have keyboard focus: click inside the CS2 window and try again.')
        self.watching = None
        self.view_set = False
        self.bar_toggled = False

    def close(self):
        self.con.close()

    def frame(self, width=1280):
        if not cs2_pid():
            raise CaptureError('cs2_closed', 'CS2 closed or crashed during capture.')
        try:
            return self.xgrab.grab(self.win, width)
        except RuntimeError as e:
            raise CaptureError('cs2_closed', f'Could not read the CS2 window ({e}).')

    def console_open(self):
        f = self.frame(640)
        w, h = f.size
        box = f.crop((int(w * .05), int(h * .739), int(w * .45), int(h * .748))).convert('L')
        lo, hi = box.getextrema()
        return hi <= 6

    def _set_console(self, want_open):
        for _ in range(3):
            if self.console_open() == want_open:
                return
            self.con.toggle()
            time.sleep(0.5)
            if want_open and self.console_open():
                # The input line takes keys a moment after the panel shows.
                time.sleep(0.6)
                return
        raise CaptureError('console', f'Could not {"open" if want_open else "close"} the CS2 console.')

    def cmd(self, text, settle=0.15):
        self._set_console(True)
        try:
            self.con.run(text)
        except self.ukeys.FocusLost:
            raise CaptureError('focus_lost', 'CS2 lost keyboard focus during capture; nothing more was typed.')
        time.sleep(settle)

    @staticmethod
    def bar_in(img):
        """True when the demo playback bar's progress track is in the frame
        (full bar ~94% down, or the collapsed bar at the bottom): a row that
        is uniformly brighter than the row 3 px above it across most of the
        width. Scored as mean/spread of that step so it still holds when a
        flash or bright scene washes out the contrast."""
        g = img.convert('L')
        if g.width != 1280:
            g = g.resize((1280, round(g.height * 1280 / g.width)))
        w, h = g.size
        x0, x1 = int(w * .3), int(w * .94)
        for y in range(int(h * .93), h - 1):
            step = ImageStat.Stat(ImageChops.subtract(g.crop((x0, y, x1, y + 1)), g.crop((x0, y - 3, x1, y - 2))))
            if step.mean[0] > 8 and step.mean[0] / (step.stddev[0] + 1) > 2:
                return True
        return False

    def demo_bar_visible(self):
        return self.bar_in(self.frame(1280))

    def hide_demo_bar(self):
        # `demoui` toggles the bar (its state persists), so check the pixels.
        for _ in range(2):
            self._set_console(False)
            time.sleep(0.4)
            if not self.demo_bar_visible():
                return
            self.cmd('demoui', settle=0.4)
            self.bar_toggled = not self.bar_toggled
        self._set_console(False)
        time.sleep(0.4)
        if self.demo_bar_visible():
            raise CaptureError('demo_ui', 'Could not hide the demo playback bar.')

    def still(self, gap=0.35, tries=4):
        # Paused if two frames match; small blinking UI is tolerated.
        for _ in range(tries):
            a = self.frame(320)
            time.sleep(gap)
            b = self.frame(320)
            if ImageStat.Stat(ImageChops.difference(a, b).convert('L')).mean[0] < 0.5:
                return True
        return False

    def load_demo(self, path, state_file):
        pid = cs2_pid()
        try:
            st = json.load(open(state_file))
        except (OSError, ValueError):
            st = {}
        if st.get('pid') == pid and st.get('demo') == path:
            return False
        # Leave any demo or map first: opening a demo over a running one is
        # where CS2's own loader is least stable.
        self.cmd('disconnect', settle=3)
        at = self.log.mark()
        self.cmd(f'playdemo "{path}"')
        m = self.log.wait(r"\[Demo\] playing demo from '([^']*)'", at, 30, 'demo_load', 'CS2 did not start playing the demo.')
        if m.group(1) != path:
            raise CaptureError('demo_load', 'CS2 opened a different demo.')
        self.log.wait(r'CSGO_GAME_UI_STATE_INGAME', at, 240, 'demo_load', 'The demo did not finish loading in CS2.')
        # Seeking straight after the load crashes CS2 ("CopyNewEntity: invalid
        # class index"): let it play until frames are moving, then a bit more.
        # (The camera can sit still on a paused match, so motion isn't required.)
        end = time.time() + 20
        time.sleep(4)
        while self.still(0.5) and time.time() < end:
            time.sleep(1)
        time.sleep(8)
        with open(state_file, 'w') as f:
            json.dump({'pid': pid, 'demo': path}, f)
        self.watching = None
        return True

    def set_view(self):
        if not self.view_set:
            self.refresh_console()
            # These can't be confirmed from the log, so each is sent twice
            # (setting a convar is idempotent).
            for k, v in VIEW.items():
                self.cmd(f'{k} {v}')
                self.cmd(f'{k} {v}')
            self.hide_demo_bar()
            self.view_set = True

    def restore(self, saved):
        for k in VIEW:
            self.cmd(f'{k} {saved[k]}')
        self.cmd('demo_timescale 1')
        if self.bar_toggled:
            self.cmd('demoui')

    def refresh_console(self):
        # After a level load the console can be visible without its input
        # line taking keys; closing and reopening it restores that.
        self._set_console(False)
        self._set_console(True)

    def _goto(self, tick, attempts=3):
        for attempt in range(attempts):
            if attempt:
                self.refresh_console()
            at = self.log.mark()
            self.cmd(f'demo_gototick {int(tick)}')
            try:
                # Skipping starts within a second when the command lands.
                m = self.log.wait(r'Demo Skipping: skipping (?:forward |back(?:ward)? )?to demo tick \d+[^\n]*', at, 4, 'seek', '')
            except CaptureError:
                continue
            self.log.wait(rf'Demo Skipping finished at tick {int(tick)}\b', at, 90, 'seek', f'CS2 did not confirm the seek to tick {tick}.')
            return m.group(0)
        raise CaptureError('seek', f'CS2 did not accept the seek to tick {tick}.')

    def seek(self, tick):
        """Pauses on exactly `tick`. A long forward skip while paused can leave
        the view on stale positions, so this always overshoots and comes back:
        a backward seek rebuilds the world from a full snapshot."""
        self.cmd('demo_pause')
        self._goto(int(tick) + 128)
        line = self._goto(int(tick))
        if 'from full packet' not in line:
            raise CaptureError('seek', 'CS2 did not rebuild the frame from a full snapshot.')
        self.cmd('demo_pause', settle=0.3)
        m = self.log.last(r'Added TrueView prediction for player slot \d+ \((.*)\)')
        self.watching = m.group(1) if m else None

    def spectate(self, name):
        if self.watching == name:
            return
        rx = r'Added TrueView prediction for player slot \d+ \((.*)\)'
        if SAFE_NAME.match(name):
            at = self.log.mark()
            self.cmd(f'spec_player "{name}"')
            try:
                m = self.log.wait(rx, at, 6, 'spectate', '')
                if m.group(1) == name:
                    self.watching = name
                    return
            except CaptureError:
                pass
        # Names that can't be typed (or didn't match): cycle targets until CS2 reports this one.
        for _ in range(12):
            at = self.log.mark()
            self.cmd('spec_next')
            try:
                m = self.log.wait(rx, at, 4, 'spectate', '')
            except CaptureError:
                continue
            self.watching = m.group(1)
            if self.watching == name:
                return
        raise CaptureError('spectate', f'CS2 could not switch to {name}\'s view.')

    def shot(self, item):
        self.seek(item['tick'])
        self.spectate(item['player'])
        self._set_console(False)
        time.sleep(0.8)
        if not self.still():
            raise CaptureError('not_paused', 'The demo kept playing; the frame would not match the tick.')
        img = self.frame(int(item.get('width', 1280)))
        if self.bar_in(img):
            self.hide_demo_bar()
            img = self.frame(int(item.get('width', 1280)))
            if self.bar_in(img):
                raise CaptureError('demo_ui', 'The demo playback bar would cover the frame.')
        img.save(item['file'], quality=90)
        return {'file': item['file'], 'tick': item['tick'], 'player': item['player'], 'width': img.width, 'height': img.height}

    def clip(self, item, tickrate):
        start, end = int(item['start']), int(item['end'])
        fps = int(item.get('fps', 30))
        ts = CLIP_TIMESCALE
        pre = max(0, start - PREROLL_TICKS)
        self.seek(pre)
        self.spectate(item['player'])
        self.hide_demo_bar()
        self.cmd(f'demo_timescale {ts}')
        first = self.frame(1280)
        w, h = first.size
        enc = subprocess.Popen(
            ['gst-launch-1.0', '-q', 'fdsrc', 'fd=0', '!', 'rawvideoparse', f'width={w}', f'height={h}', 'format=rgb',
             f'framerate={fps}/1', '!', 'videoconvert', '!', 'vp8enc', 'deadline=1', 'cpu-used=4', 'target-bitrate=6000000',
             '!', 'webmmux', '!', 'filesink', f'location={item["file"]}'],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        frames = round((end - start) / tickrate * fps)
        lag = 0.0
        try:
            self.con.run('demo_resume')  # console is open (cmd above)
            t0 = time.time()
            self.con.toggle()  # close it during the pre-roll
            pre_s = (start - pre) / tickrate
            for k in range(frames):
                target = t0 + (pre_s + k / fps) / ts
                now = time.time()
                if target > now:
                    time.sleep(target - now)
                lag = max(lag, time.time() - target)
                enc.stdin.write(self.frame(w).tobytes())
        except self.ukeys.FocusLost:
            raise CaptureError('focus_lost', 'CS2 lost keyboard focus during capture; nothing more was typed.')
        finally:
            try:
                enc.stdin.close()
            except OSError:
                pass
            enc.wait(timeout=60)
            try:
                self.cmd('demo_pause')
                self.cmd('demo_timescale 1')
            except CaptureError:
                pass
        if enc.returncode != 0:
            raise CaptureError('encode', 'Encoding the clip failed.')
        # Lag in game ticks: how late the worst frame was sampled.
        return {'file': item['file'], 'start': start, 'end': end, 'player': item['player'], 'fps': fps, 'frames': frames,
                'width': w, 'height': h, 'max_lag_ticks': round(lag * ts * tickrate, 2), 'timescale': ts}


def run(job):
    demo = job['demo']
    if not SAFE_PATH.match(demo) or not os.path.exists(demo):
        raise CaptureError('bad_job', 'Demo path is not usable.')
    tickrate = float(job.get('tickrate') or 64)
    saved = user_convars()
    d = Driver(focus_wait=float(job.get('focus_wait', 3)))
    results = []
    try:
        d.load_demo(demo, job['state'])
        d.set_view()
        for item in job['items']:
            if item['type'] == 'shot':
                results.append(d.shot(item))
            elif item['type'] == 'clip':
                results.append(d.clip(item, tickrate))
            else:
                raise CaptureError('bad_job', 'Unknown item type.')
    finally:
        try:
            d.restore(saved)
            d._set_console(False)
        except CaptureError:
            pass
        d.close()
    return results


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'status':
        print(json.dumps(status()))
        return
    if mode == 'run':
        job = json.load(sys.stdin)
        try:
            print(json.dumps({'ok': True, 'items': run(job)}))
        except CaptureError as e:
            print(json.dumps({'ok': False, 'code': e.code, 'error': str(e)}))
        except Exception as e:  # noqa: BLE001 - reported to the server, not swallowed
            print(json.dumps({'ok': False, 'code': 'internal', 'error': f'{type(e).__name__}: {e}'}))
        return
    sys.exit(__doc__)


if __name__ == '__main__':
    main()
