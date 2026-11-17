#!/usr/bin/env python3
"""CS2 demo capture driver for the Replay Inspector.

Drives a CS2 client to play a demo and records real first-person frames:

- control: console commands typed through a uinput virtual keyboard
  (ukeys.py), only while the CS2 window has input focus (checked before
  every command; focus is recovered automatically, see launcher.py);
- confirmation: each step is checked against the game's own console log
  (demo loaded, seek finished at the exact tick, which player is watched)
  or its pixels (console open/closed, playback paused, demo bar hidden);
- capture: the CS2 window's pixels read through XWayland (xgrab.py); clips
  are frames sampled while the demo plays at reduced speed, encoded to WebM
  (VP8) with GStreamer.

Nothing is drawn or synthesised: a file holds pixels CS2 rendered for that
tick and player, or the step fails with a reason.

Usage:
  capture.py status            JSON readiness report
  capture.py session           JSON-lines session on stdin/stdout:
      {"id": 1, "op": "open", "state_dir": "...", "size": [1280, 720], "profile": "capture"}
      {"id": 2, "op": "load", "demo": "/abs/x.dem"}
      {"id": 3, "op": "kill", ...}   {"id": 4, "op": "utility", ...}
      {"id": 5, "op": "watch", "demo": "/abs/x.dem", "tick": 1234}
      {"id": 6, "op": "close", "keep_open": false}
    Replies: {"id": n, "ok": true, ...} or {"id": n, "ok": false, "code", "error"};
    progress lines: {"stage": "..."}.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import ImageChops, ImageStat  # noqa: E402

import xconsole as xc  # noqa: E402

GAME = os.path.expanduser('~/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo')
LOG = os.path.join(GAME, 'console.log')
SAFE_NAME = re.compile(r'^[A-Za-z0-9 _.\-]{1,32}$')
SAFE_PATH = re.compile(r'^/[A-Za-z0-9 _./\-]+\.dem$')
# Convars changed while capturing, restored afterwards. Spectator X-ray
# outlines players through walls, which the player didn't see, so it is off
# unless an event asks for it (flash / through-smoke kills, labelled). The
# HUD is reduced to crosshair and kill feed (also hides the demo bar).
VIEW = {'spec_show_xray': '0', 'cl_draw_only_deathnotices': '1'}
DEFAULTS = {'spec_show_xray': '1', 'cl_draw_only_deathnotices': '0'}
 # Readiness tuning (measured; see README Phase 14).
INPUT_READY_S = 0.25     # console input accepts keys this long after it shows
LOAD_SETTLE_S = 1.0      # after CS2 reports a spectator prediction post-load
MAX_PENDING_ENCODES = 3  # finished clips still encoding before we wait
PREROLL_TICKS = 32       # minimum demo ticks played before a clip's first frame
PREROLL_REAL_S = 0.6     # ...and at least this much real time (console closing)
FF_SPEED = 8             # play-through navigation speed
FF_MARGIN_REAL_S = 0.35  # stop this long (real time) before the target
SEEK_RX = r'Demo Skipping: skipping (?:forward |back(?:ward)? )?to demo tick \d+[^\n]*'
# CS2's own resync after a POV change: up to ~1 s after TrueView prediction
# starts, it skips to the tick before the current one and resumes playback.
RESYNC_RX = r'Demo Skipping: skipping to demo tick (\d+) \(game tick \d+\) from full packet[^\n]*Current playback is (\d+)'
RESYNC_WAIT_S = 0  # measured: 1.6 s waits caught no resync (17 Nov); detection stays
TRUEVIEW_RX = r'Added TrueView prediction for player slot \d+ \((.*)\)'


class CaptureError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def emit(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def stage(text):
    emit({'stage': text})


def cs2_pid():
    out = subprocess.run(['pgrep', '-x', 'cs2'], capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


def uinput_ok():
    return os.access('/dev/uinput', os.W_OK)


def status():
    import launcher
    root, lib = launcher.game_root()
    pid, usable = launcher.Instance(None).find_running()
    gst = subprocess.run(['gst-inspect-1.0', 'vp8enc'], capture_output=True).returncode == 0
    return {'cs2_installed': bool(root), 'runtime': bool(lib and launcher.runtime(lib)), 'uinput': uinput_ok(), 'encoder': gst,
            'cs2_running': pid is not None, 'cs2_usable': bool(usable)}


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
    """Tails console.log (-condebug)."""

    def __init__(self, tail=4_000_000):
        self.pos = max(0, os.path.getsize(LOG) - tail) if os.path.exists(LOG) else 0
        self.text = ''
        self.read()

    def read(self):
        if not os.path.exists(LOG):
            return self.text
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
            time.sleep(0.1)

    def last(self, pattern, since=0):
        ms = list(re.finditer(pattern, self.read()[since:]))
        return ms[-1] if ms else None


class Timer:
    def __init__(self):
        self.t = {}

    def add(self, key, seconds):
        self.t[key] = round(self.t.get(key, 0) + seconds, 3)

    def run(self, key, fn, *a, **kw):
        t0 = time.time()
        try:
            return fn(*a, **kw)
        finally:
            self.add(key, time.time() - t0)


class Driver:
    def __init__(self, win, short_forward=0, timescale=0.5, paste=True, state_dir=None):
        import ukeys
        import xgrab
        self.xgrab = xgrab
        self.ukeys = ukeys
        self.win = win
        self.log = Log()
        self.con = ukeys.Console(paste=paste, save_to=os.path.join(state_dir, 'clipboard.txt') if state_dir else None)
        # Pasted commands whose expected effect never showed (retried typed).
        self.paste_failures = []
        # Finished clips still encoding (bounded; see finish_encoders).
        self.encoded = []
        self.encode_failed = []
        self.watching = None
        self.tick = None          # tick CS2 is at (exact when self.exact, else a lower bound)
        self.exact = False        # paused exactly on self.tick (confirmed seek, no POV change since)
        self.paused = False       # known to be paused
        self.xray = None          # current spec_show_xray value we set
        self.view_set = False
        self.bar_toggled = False
        self.demo = None
        # Forward seeks of at most this many ticks use one command; longer
        # ones overshoot and come back (see seek()).
        self.short_forward = short_forward
        self.timescale = timescale
        # Wait for CS2's resync after a POV change (see _settle_pov); 0 skips
        # the wait and relies on detecting the resync after the seek.
        self.pov_settle_s = RESYNC_WAIT_S
        self.encoders = []
        self.debug_dir = None  # when set, failed checks save evidence here
        self.nav = 'seek'      # how clips reach their pre-roll: 'seek' or 'play'

    def close(self):
        self.con.close()

    # ---- focus and console ------------------------------------------------

    def ensure_focus(self):
        if self.con.has_focus():
            return
        how = self.ukeys.focus_window(self.win)
        if not how:
            raise CaptureError('focus', 'CS2 could not be given keyboard focus (another window may be on top of it).')

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
        return box.getextrema()[1] <= 6

    def _set_console(self, want_open):
        """Opens or closes the console, polling its pixels instead of
        waiting a fixed time."""
        for _ in range(3):
            if self.console_open() == want_open:
                return
            self.ensure_focus()
            self.con.toggle()
            end = time.time() + 1.0
            while time.time() < end:
                if self.console_open() == want_open:
                    if want_open:
                        # The input line takes keys a moment after the panel
                        # shows (the first command was lost without this).
                        time.sleep(INPUT_READY_S)
                    return
                time.sleep(0.03)
        raise CaptureError('console', f'Could not {"open" if want_open else "close"} the CS2 console.')

    def cmd(self, text, settle=0.0, typed=False):
        self._set_console(True)
        for attempt in range(2):
            try:
                self.con.run(text, typed=typed)
                break
            except self.ukeys.FocusLost:
                if attempt:
                    raise CaptureError('focus_lost', 'CS2 lost keyboard focus during capture; nothing more was typed.')
                self.ensure_focus()
                self._set_console(True)
        time.sleep(settle)

    def refresh_console(self):
        # After a level load the console can be visible without its input
        # line taking keys; closing and reopening it restores that.
        self._set_console(False)
        self._set_console(True)

    # ---- demo playback bar --------------------------------------------------

    @staticmethod
    def bar_in(img):
        """True when the demo playback bar's progress track is in the frame
        (full bar ~94% down, or the collapsed bar at the bottom): a row that
        is uniformly brighter than the row 3 px above it across most of the
        width, scored as mean/spread so it holds when a flash washes out the
        contrast."""
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

    def hide_demo_bar(self):
        # `demoui` toggles the bar (its state persists), so check the pixels.
        for _ in range(2):
            self._set_console(False)
            time.sleep(0.3)
            if not self.bar_in(self.frame(1280)):
                return
            self.cmd('demoui', settle=0.3)
            self.bar_toggled = not self.bar_toggled
        self._set_console(False)
        time.sleep(0.3)
        if self.bar_in(self.frame(1280)):
            raise CaptureError('demo_ui', 'Could not hide the demo playback bar.')

    def still(self, gap=0.3, tries=6):
        # Paused if two frames match; small blinking UI is tolerated.
        for i in range(tries):
            a = self.frame(320)
            time.sleep(gap)
            b = self.frame(320)
            dv = ImageStat.Stat(ImageChops.difference(a, b).convert('L')).mean[0]
            # Paused frames still differ a little (smoke particles, X-ray
            # glow): measured 0.5-0.6; a playing demo differs by 5-25.
            if dv < 2.0:
                return True
        if self.debug_dir:
            n = len(os.listdir(self.debug_dir))
            a.save(os.path.join(self.debug_dir, f'{n:03d}_notstill_a.png'))
            b.save(os.path.join(self.debug_dir, f'{n:03d}_notstill_b.png'))
            with open(os.path.join(self.debug_dir, f'{n:03d}_notstill.txt'), 'w') as f:
                f.write(f'diff {dv:.3f} tick {self.tick}\n' + '\n'.join(self.log.read()[-6000:].splitlines()[-60:]))
        return False

    # ---- demo, view, seeking ------------------------------------------------

    def current_demo(self):
        m = self.log.last(r"\[Demo\] playing demo from '([^']*)'")
        return m.group(1) if m else None

    def load_demo(self, path):
        if not SAFE_PATH.match(path) or not os.path.exists(path):
            raise CaptureError('bad_job', 'Demo path is not usable.')
        if self.demo == path:
            return False
        # Leave any demo or map first: opening a demo over a running one is
        # where CS2's own loader is least stable.
        self.refresh_console()
        if self.log.last(r'CSGO_GAME_UI_STATE_INGAME') or self.demo:
            at = self.log.mark()
            self.cmd('disconnect')
            try:
                self.log.wait(r'CSGO_GAME_UI_STATE_MAINMENU|SIGNONSTATE_NONE', at, 5, 'x', '')
            except CaptureError:
                pass
        # The command can be lost while the main menu is still settling
        # (seen after a shader rebuild): retry with a fresh console, typed.
        for attempt in range(3):
            if attempt:
                self.refresh_console()
            at = self.log.mark()
            self.cmd(f'playdemo "{path}"', typed=attempt > 0)
            try:
                m = self.log.wait(r"\[Demo\] playing demo from '([^']*)'", at, 12, 'demo_load', 'CS2 did not start playing the demo.')
                break
            except CaptureError:
                if attempt == 0:
                    self.paste_failures.append('playdemo')
                if attempt == 2:
                    raise
        if m.group(1) != path:
            raise CaptureError('demo_load', 'CS2 opened a different demo.')
        self.log.wait(r'CSGO_GAME_UI_STATE_INGAME', at, 240, 'demo_load', 'The demo did not finish loading in CS2.')
        # Seeking straight after the load crashed CS2 once ("CopyNewEntity:
        # invalid class index"). Ready once CS2 has set up a spectator
        # prediction (its entities exist), instead of a fixed 6 s.
        try:
            self.log.wait(r'Added TrueView prediction|TrueView active', at, 15, 'x', '')
        except CaptureError:
            time.sleep(3)
        time.sleep(LOAD_SETTLE_S)
        self.demo = path
        self.watching = None
        self.tick = None
        self.exact = False
        self.paused = False
        self.view_set = False
        return True

    def set_view(self, xray=False):
        want = '1' if xray else '0'
        if not self.view_set:
            self.refresh_console()
            self.cmd(f'cl_draw_only_deathnotices {VIEW["cl_draw_only_deathnotices"]}')
            self.view_set = True
        if self.xray != want:
            self.cmd(f'spec_show_xray {want}')
            self.xray = want

    def restore(self, saved):
        for k in VIEW:
            self.cmd(f'{k} {saved[k]}')
        self.cmd('demo_timescale 1')
        if self.bar_toggled:
            self.cmd('demoui')
            self.bar_toggled = False
        self.view_set = False
        self.xray = None

    def tick_offset(self):
        """Game tick minus demo tick, from CS2's last seek line."""
        m = self.log.last(r'skipping (?:forward |back(?:ward)? )?to demo tick (\d+) \(game tick (\d+)\)')
        return int(m.group(2)) - int(m.group(1)) if m else None

    def pause_here(self):
        """Pauses playback and returns the demo tick CS2 paused on (from its
        'paused on tick' log line), or None when it can't be read."""
        at = self.log.mark()
        self.cmd('demo_pause', settle=0)
        off = self.tick_offset()
        try:
            m = self.log.wait(r'CGameRules - paused on tick (\d+)', at, 3, 'pause', '')
        except CaptureError:
            self.tick = None
            return None
        if off is None:
            self.tick = None
            return None
        self.tick = int(m.group(1)) - off
        return self.tick

    def play_to(self, target, timer=None):
        """Play-through navigation: from a known paused tick before `target`,
        plays at FF_SPEED and pauses just short of it. Keeps the world's
        played history (smoke, fire) intact, unlike a seek. Returns the tick
        it paused on, or None (caller falls back to seeking)."""
        if self.tick is None or target <= self.tick:
            return None
        t0 = time.time()
        margin = FF_MARGIN_REAL_S * FF_SPEED * 64
        span = target - self.tick - margin
        if span > 0:
            self.cmd(f'demo_timescale {FF_SPEED}')
            self.ensure_focus()
            self.con.run('demo_resume')
            time.sleep(span / 64 / FF_SPEED)
            got = self.pause_here()
        else:
            got = self.tick
        if timer:
            timer.add('play_nav', time.time() - t0)
            timer.add('play_nav_count', 1)
        if got is None or got > target:
            self.tick = None
            return None
        return got

    def _goto(self, tick, attempts=3):
        for attempt in range(attempts):
            if attempt:
                self.refresh_console()
            at = self.log.mark()
            self.cmd(f'demo_gototick {int(tick)}', typed=attempt > 0)
            try:
                # Skipping starts within a second when the command lands.
                m = self.log.wait(SEEK_RX, at, 4, 'seek', '')
            except CaptureError:
                if attempt == 0:
                    self.paste_failures.append('demo_gototick')
                continue
            self.log.wait(rf'Demo Skipping finished at tick {int(tick)}\b', at, 90, 'seek', f'CS2 did not confirm the seek to tick {tick}.')
            self.tick = int(tick)
            return m.group(0)
        raise CaptureError('seek', f'CS2 did not accept the seek to tick {tick}.')

    def seek(self, tick, timer=None):
        """Pauses on exactly `tick`.

        A backward seek always rebuilds the world from a full snapshot, so it
        is one command. A forward seek is one command only from an exact
        paused position and at most `short_forward` ticks (64-400 ticks
        rendered identically live; a 1,500-tick skip once left the camera
        stale). Otherwise it overshoots and comes back. Changing POV makes
        CS2 skip back a tick and resume playback, so after a switch the demo
        is paused first and the position counts as a lower bound."""
        t0 = time.time()
        tick = int(tick)
        if not self.paused:
            self.cmd('demo_pause')
            self.paused = True
        mode = 'overshoot'
        if self.tick is not None and tick < self.tick:
            mode = 'backward'
        elif self.exact and self.tick is not None and 0 < tick - self.tick <= self.short_forward:
            mode = 'forward'
        elif self.exact and self.tick == tick:
            mode = 'none'
        if mode == 'overshoot':
            self._goto(tick + 128)
            line = self._goto(tick)
            if 'from full packet' not in line:
                raise CaptureError('seek', 'CS2 did not rebuild the frame from a full snapshot.')
        elif mode != 'none':
            try:
                self._goto(tick, attempts=2)
            except CaptureError:
                # No skip line: CS2 ignores a seek to the tick it is already
                # on (our position was only a bound). Overshoot and come back.
                if timer:
                    timer.add('seek_fallback_count', 1)
                mode = 'overshoot'
                self._goto(tick + 128)
                self._goto(tick)
        self.exact = True
        m = self.log.last(TRUEVIEW_RX)
        if m:
            self.watching = m.group(1)
        if timer:
            timer.add('seek', time.time() - t0)
            timer.add(f'seek_{mode}_count', 1)
        return mode

    def spectate(self, name, timer=None, quick=False):
        """Switches the view to `name` (confirmed by CS2's TrueView line).
        quick: one pasted attempt, no fallbacks - fails fast when the player
        is dead (or not yet spawned) at the current tick."""
        t0 = time.time()
        switched = [False]
        try:
            if self.watching == name:
                return True
            switched[0] = True
            # CS2 skips back a tick and resumes playback on a POV change.
            self.paused = False
            self.exact = False
            # Pasting sends any name, including ones that can't be typed.
            tries = [False] if quick or not SAFE_NAME.match(name) else [False, True]
            for typed in tries:
                at = self.log.mark()
                self.cmd(f'spec_player "{name}"', typed=typed)
                try:
                    m = self.log.wait(TRUEVIEW_RX, at, 1.5 if quick else 3, 'spectate', '')
                    if m.group(1) == name:
                        if typed:
                            self.paste_failures.append('spec_player')  # typed worked where the paste didn't
                        self.watching = name
                        self._settle_pov(m.end(), timer)
                        return True
                    self.watching = m.group(1)
                except CaptureError:
                    pass
            if quick:
                return False
            # Names that can't be typed (or didn't match): cycle targets until CS2 reports this one.
            for _ in range(12):
                at = self.log.mark()
                self.cmd('spec_next', settle=0)
                try:
                    m = self.log.wait(TRUEVIEW_RX, at, 4, 'spectate', '')
                except CaptureError:
                    continue
                self.watching = m.group(1)
                if self.watching == name:
                    self._settle_pov(m.end(), timer)
                    return True
            raise CaptureError('spectate', f'CS2 could not switch to {name}\'s view.')
        finally:
            if timer:
                timer.add('pov_switch', time.time() - t0)
                if switched[0]:
                    timer.add('pov_switch_count', 1)

    def pov_at(self, name, tick, timer=None):
        """Watches `name` and pauses exactly on `tick`. The POV goes first
        (a switch resumes playback; the seek then pauses exactly), unless the
        player can't be watched where the demo is now (dead there): then seek
        to the tick first, switch, and seek again."""
        if not self.spectate(name, timer, quick=True):
            if timer:
                timer.add('pov_seek_first_count', 1)
            self.seek(tick, timer)
            self.spectate(name, timer)
        at = self.log.mark()
        self.seek(tick, timer)
        return at

    def resyncs(self, since):
        """CS2's own skip-back-and-resume lines after `since` (log offset)."""
        return [m for m in re.finditer(RESYNC_RX, self.log.read()[since:]) if int(m.group(1)) == int(m.group(2)) - 1]

    def _settle_pov(self, since, timer=None):
        """After a POV change CS2 may skip back a tick and resume playback up
        to ~1 s later. Seeking before that lands makes the seek look done
        while the demo then plays on, so wait for it (or for the window to
        pass) before seeking."""
        t0 = time.time()
        end = t0 + self.pov_settle_s
        while time.time() < end:
            hits = self.resyncs(since)
            if hits:
                at = since + hits[-1].end()
                self.log.wait(r'Demo Skipping finished at tick \d+', at, 30, 'spectate', 'CS2 did not finish its resync after the POV change.')
                if timer:
                    timer.add('pov_resync_count', 1)
                break
            time.sleep(0.05)
        self.paused = False
        self.exact = False
        if timer:
            timer.add('pov_settle', time.time() - t0)

    # ---- capture ------------------------------------------------------------

    def shot(self, tick, player, file, width=1280, timer=None, mode=None):
        # POV first: switching resumes playback, the seek then pauses exactly.
        at = self.pov_at(player, tick, timer)
        t0 = time.time()
        self._set_console(False)
        if self.resyncs(at) or not self.still():
            # Still moving: pause and seek again (overshoot and back).
            self.paused = False
            self.exact = False
            self.tick = None
            self.seek(tick, timer)
            self._set_console(False)
            if not self.still():
                raise CaptureError('not_paused', 'The demo kept playing; the frame would not match the tick.')
        img = self.frame(width)
        if self.bar_in(img):
            self.hide_demo_bar()
            img = self.frame(width)
            if self.bar_in(img):
                raise CaptureError('demo_ui', 'The demo playback bar would cover the frame.')
        img.save(file, quality=90)
        if timer:
            timer.add('still', time.time() - t0)
        return {'file': file, 'tick': int(tick), 'player': player, 'width': img.width, 'height': img.height}

    def clip(self, start, end, player, file, tickrate, fps=30, timer=None, grab_ticks=(), nav='seek'):
        """Records ticks start..end from `player`'s view as a clip that plays
        at normal demo speed (`fps` output frames per demo second).

        The demo plays at `self.timescale` (1x, 2x, 4x, 8x...). Frames are
        grabbed as fast as the window can be read and each output frame takes
        the grab nearest its moment, so fast recording repeats frames rather
        than drifting; `distinct_frames` reports how many different grabs
        made it into the clip. Navigation to the pre-roll: 'seek' (verified
        overshoot/backward seek) or 'play' (play through at FF_SPEED from the
        current paused tick when it is before the clip, else seek)."""
        ts = self.timescale
        pre_ticks = max(PREROLL_TICKS, int(PREROLL_REAL_S * ts * tickrate))
        want = max(0, start - pre_ticks)
        here = None
        if nav == 'play' and self.tick is not None and self.tick < want:
            here = self.play_to(want, timer)
        if here is None:
            self.pov_at(player, want, timer)
            here = want
        self.spectate(player, timer)
        self.hide_demo_bar()
        self.cmd(f'demo_timescale {ts}')
        first = self.frame(1280)
        w, h = first.size
        enc = subprocess.Popen(
            ['gst-launch-1.0', '-q', 'fdsrc', 'fd=0', '!', 'rawvideoparse', f'width={w}', f'height={h}', 'format=rgb',
             f'framerate={fps}/1', '!', 'videoconvert', '!', 'vp8enc', 'deadline=1', 'cpu-used=4', 'target-bitrate=4000000',
             '!', 'webmmux', '!', 'filesink', f'location={file}'],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        frames = round((end - start) / tickrate * fps)
        kept = {}
        grabs = 0
        used = set()
        worst = 0.0
        t_rec = time.time()
        try:
            self.ensure_focus()
            self.con.run('demo_resume')  # console is open (cmd above)
            t0 = time.time()
            self.con.toggle()  # close it during the pre-roll
            lead = (start - here) / tickrate  # demo seconds before the first frame

            def due(k):  # real time at which output frame k's moment plays
                return t0 + (lead + k / fps) / ts
            # Wait for the pre-roll, then grab continuously.
            first_due = due(0) - 0.02
            if first_due > time.time():
                time.sleep(first_due - time.time())
            prev = None  # (time, grab id, image)
            k = 0
            while k < frames:
                img = self.frame(w)
                now = time.time()
                grabs += 1
                cur = (now, grabs, img)
                # Emit every output frame whose moment has passed, from the
                # grab closest in time (previous or this one).
                while k < frames and due(k) <= now:
                    pick = prev if prev and abs(prev[0] - due(k)) < abs(now - due(k)) else cur
                    worst = max(worst, abs(pick[0] - due(k)))
                    used.add(pick[1])
                    tk = start + k * tickrate / fps
                    for g in grab_ticks:
                        if abs(tk - g) < 1e-6:
                            kept[g] = pick[2]
                    enc.stdin.write(pick[2].tobytes())
                    k += 1
                prev = cur
                if k < frames and due(k) > time.time() + 0.004 and ts <= 1:
                    # Real-time (or slower) recording: no need to spin.
                    time.sleep(max(0, due(k) - time.time() - 0.003))
        except self.ukeys.FocusLost:
            raise CaptureError('focus_lost', 'CS2 lost keyboard focus during capture; nothing more was typed.')
        finally:
            try:
                enc.stdin.close()
            except OSError:
                pass
            got = self.pause_here()
            if got is None:
                # Paused at or just after `end`: any seek before it is backward.
                self.tick = int(end)
            if timer:
                timer.add('record', time.time() - t_rec)
        done = {'returncode': None, 'wait': 0.0}

        def wait():
            t = time.time()
            enc.wait(timeout=120)
            done['returncode'] = enc.returncode
            done['wait'] = time.time() - t
        th = threading.Thread(target=wait)
        th.start()
        self.encoders.append((th, done, file, timer))
        return {'file': file, 'start': int(start), 'end': int(end), 'player': player, 'fps': fps, 'frames': frames,
                'width': w, 'height': h, 'timescale': ts, 'grabs': grabs, 'distinct_frames': len(used),
                # Worst gap between a frame's moment and its grab, in demo ticks.
                'max_lag_ticks': round(worst * ts * tickrate, 2)}, kept

    def finish_encoders(self, limit=0):
        """Waits until at most `limit` finished clips are still encoding
        (bounded queue: encoding overlaps the next seek or recording)."""
        t0 = time.time()
        while len(self.encoders) > limit:
            th, done, file, timer = self.encoders.pop(0)
            th.join()
            if done['returncode'] != 0:
                self.encode_failed.append(file)
            else:
                self.encoded.append(file)
            if timer:
                timer.add('encode_tail', done['wait'])
        waited = time.time() - t0
        if self.encode_failed and limit == 0 and False:
            pass
        return waited

    def drain_encoded(self):
        # Clips whose encoders already finished, without waiting.
        still = []
        for th, done, file, timer in self.encoders:
            if not th.is_alive():
                (self.encoded if done['returncode'] == 0 else self.encode_failed).append(file)
            else:
                still.append((th, done, file, timer))
        self.encoders = still
        enc, bad = self.encoded, self.encode_failed
        self.encoded, self.encode_failed = [], []
        return enc, bad

    def record_segment(self, seg, tickrate, timer=None):
        """One recording pass from `seg['player']`'s view over ticks
        seg.start..seg.end, cut into any number of output clips (each with
        its own window inside the segment), so overlapping windows with the
        same POV and settings are recorded once. Frames go to every output
        whose window covers them; each output plays at normal demo speed
        (fps frames per demo second)."""
        start, end = int(seg['start']), int(seg['end'])
        ts = self.timescale
        fps = int(seg.get('fps', 30))
        # Bounded encode queue: wait only if too many clips are still encoding.
        if timer:
            timer.add('encode_wait', self.finish_encoders(MAX_PENDING_ENCODES - 1))
        else:
            self.finish_encoders(MAX_PENDING_ENCODES - 1)
        self.set_view(bool(seg.get('xray')))
        pre_ticks = max(PREROLL_TICKS, int(PREROLL_REAL_S * ts * tickrate))
        want = max(0, start - pre_ticks)
        # POV first (a switch resumes playback), then the exact seek.
        at_seek = self.pov_at(seg['player'], want, timer)
        if self.resyncs(at_seek):
            # CS2 resumed after the seek: pause and seek again.
            self.paused = False
            self.exact = False
            at_seek = self.log.mark()
            self.seek(want, timer)
            if timer:
                timer.add('reseek_count', 1)
        here = want
        self.hide_demo_bar()
        self.cmd(f'demo_timescale {ts}')
        first = self.frame(1280)
        w, h = first.size
        outs = []
        for o in seg['outputs']:
            outs.append({'file': o['file'], 'start': int(o['start']), 'end': int(o['end']),
                         'frames': max(1, round((int(o['end']) - int(o['start'])) / tickrate * fps)), 'k': 0, 'enc': None,
                         'used': set(), 'worst': 0.0})
        schedule = sorted(((o['start'] - here) / tickrate + k / fps, i) for i, o in enumerate(outs) for k in range(o['frames']))

        def open_enc(o):
            return subprocess.Popen(
                ['gst-launch-1.0', '-q', 'fdsrc', 'fd=0', '!', 'rawvideoparse', f'width={w}', f'height={h}', 'format=rgb',
                 f'framerate={fps}/1', '!', 'videoconvert', '!', 'vp8enc', 'deadline=1', 'cpu-used=4', 'target-bitrate=4000000',
                 '!', 'webmmux', '!', 'filesink', f'location={o["file"]}'],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        grabs = 0
        t_rec = time.time()
        try:
            self.ensure_focus()
            self.con.run('demo_resume')  # console is open (cmd above)
            t0 = time.time()
            self.con.toggle()  # close it during the pre-roll
            due = lambda gt: t0 + gt / ts  # noqa: E731
            if schedule and due(schedule[0][0]) - 0.02 > time.time():
                time.sleep(due(schedule[0][0]) - 0.02 - time.time())
            prev = None
            n = 0
            while n < len(schedule):
                img = self.frame(w)
                now = time.time()
                grabs += 1
                cur = (now, grabs, img)
                while n < len(schedule) and due(schedule[n][0]) <= now:
                    gt, i = schedule[n]
                    o = outs[i]
                    d = due(gt)
                    pick = prev if prev and abs(prev[0] - d) < abs(now - d) else cur
                    o['worst'] = max(o['worst'], abs(pick[0] - d))
                    o['used'].add(pick[1])
                    if o['enc'] is None:
                        o['enc'] = open_enc(o)
                    o['enc'].stdin.write(pick[2].tobytes())
                    o['k'] += 1
                    if o['k'] == o['frames']:
                        self._finish_output(o, timer)
                    n += 1
                prev = cur
                if n < len(schedule) and ts <= 1 and due(schedule[n][0]) > time.time() + 0.004:
                    time.sleep(max(0, due(schedule[n][0]) - time.time() - 0.003))
        except self.ukeys.FocusLost:
            raise CaptureError('focus_lost', 'CS2 lost keyboard focus during capture; nothing more was typed.')
        finally:
            for o in outs:
                if o['enc'] is not None and o['k'] < o['frames']:
                    self._finish_output(o, timer)
            self.cmd('demo_pause')
            self.paused = True
            self.exact = False
            self.tick = int(end)  # paused at or just after the end: earlier seeks are backward
            if timer and self.resyncs(at_seek):
                timer.add('resync_during_record_count', 1)
            if timer:
                timer.add('record', time.time() - t_rec)
        return [{'file': o['file'], 'start': o['start'], 'end': o['end'], 'player': seg['player'], 'fps': fps, 'frames': o['frames'],
                 'width': w, 'height': h, 'timescale': ts, 'distinct_frames': len(o['used']), 'xray': bool(seg.get('xray')),
                 'max_lag_ticks': round(o['worst'] * ts * tickrate, 2), 'segment': [start, end]} for o in outs]

    def _finish_output(self, o, timer):
        enc = o['enc']
        try:
            enc.stdin.close()
        except OSError:
            pass
        done = {'returncode': None, 'wait': 0.0}

        def wait():
            t = time.time()
            enc.wait(timeout=120)
            done['returncode'] = enc.returncode
            done['wait'] = time.time() - t
        th = threading.Thread(target=wait)
        th.start()
        self.encoders.append((th, done, o['file'], timer))


# ---- events -------------------------------------------------------------------

def kill_event(d, job):
    """Killer and victim POV for one kill: a clip centred on the kill (each
    side) and stills (killer at the kill tick, victim at the last alive
    tick). Order keeps seeks backward (single command) after the first."""
    timer = Timer()
    tickrate = float(job.get('tickrate') or 64)
    xray = bool(job.get('xray'))
    d.set_view(xray)
    out = {}
    pov = job['povs']  # {"killer": {...}, "victim": {...}} with player, clip_file, still_file, still_tick
    start, end = int(job['start']), int(job['end'])
    # Order: killer clip, killer still, victim still, victim clip. After the
    # first seek every seek goes backward (kill tick ≥ last alive tick ≥
    # clip start), so each is one command; the victim clip needs no switch.
    k, v = pov.get('killer'), pov.get('victim')
    steps = []
    if k and k.get('clip_file'):
        steps.append(('killer', 'clip', k))
    if k and k.get('still_file'):
        steps.append(('killer', 'still', k))
    if v and v.get('still_file'):
        steps.append(('victim', 'still', v))
    if v and v.get('clip_file'):
        steps.append(('victim', 'clip', v))
    for role, what, p in steps:
        res = out.setdefault(role, {})
        if what == 'clip':
            res['clip'], _ = d.clip(start, end, p['player'], p['clip_file'], tickrate, timer=timer, nav=job.get('nav', 'seek'))
        else:
            res['still'] = d.shot(p['still_tick'], p['player'], p['still_file'], timer=timer)
    d.finish_encoders()
    for role in out.values():
        for m in role.values():
            m['xray'] = xray
    return {'povs': out, 'timings': timer.t}


def utility_event(d, job):
    """The thrower's clip around the release and the lineup still the tick
    before release (when the release is known)."""
    timer = Timer()
    tickrate = float(job.get('tickrate') or 64)
    d.set_view(False)
    res = {}
    if job.get('clip_file'):
        res['clip'], _ = d.clip(int(job['start']), int(job['end']), job['player'], job['clip_file'], tickrate, timer=timer, nav=job.get('nav', 'seek'))
    if job.get('lineup_file') and job.get('lineup_tick') is not None:
        res['lineup'] = d.shot(int(job['lineup_tick']), job['player'], job['lineup_file'], width=int(job.get('lineup_width') or 1280), timer=timer)
    d.finish_encoders()
    return {**res, 'timings': timer.t}


def watch(d, job, saved):
    """Opens the demo at a round start for the player to watch: normal view
    (their own X-ray/HUD settings, playback bar shown), paused, game left open."""
    timer = Timer()
    path = job['demo']
    timer.run('demo_load', d.load_demo, path)
    if d.current_demo() != path:
        raise CaptureError('demo_load', 'CS2 is showing a different demo.')
    d.restore(saved)
    d.seek(int(job['tick']), timer)
    d._set_console(False)
    return {'demo': path, 'tick': d.tick, 'timings': timer.t}


# ---- session loop -------------------------------------------------------------

def session():
    import launcher
    inst = None
    d = None
    saved = user_convars()
    keep_open = False

    def reply(req, **kw):
        emit({'id': req.get('id'), **kw})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        op = req.get('op')
        try:
            if op == 'open':
                t0 = time.time()
                state_dir = req['state_dir']
                launcher.Instance.recover(state_dir)
                inst = launcher.Instance(state_dir)
                pid, usable = inst.find_running()
                timings = {}
                if pid and usable:
                    stage('Using the CS2 that is already open')
                    inst.use_running(pid)
                    reused = True
                elif pid:
                    raise CaptureError('cs2_running', 'CS2 is already open without the console log (-condebug), so capture can\'t confirm its steps. Close CS2 and try again.')
                else:
                    stage('Starting CS2')
                    try:
                        inst.launch(req.get('profile', 'capture') or None, tuple(req.get('size') or (1280, 720)))
                    except RuntimeError as e:
                        code, msg = str(e).split('|', 1)
                        raise CaptureError(code, msg)
                    reused = False
                try:
                    win = inst.wait_window()
                except RuntimeError as e:
                    code, msg = str(e).split('|', 1)
                    raise CaptureError(code, msg)
                timings['window'] = round(time.time() - t0, 3)
                if not reused:
                    stage('Waiting for the CS2 main menu')
                    end = time.time() + 180
                    while not os.path.exists(LOG) and time.time() < end:
                        time.sleep(0.5)
                    lg = Log(tail=10_000_000)
                    try:
                        lg.wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 120, 'cs2_start', 'CS2 did not reach the main menu.')
                    except CaptureError:
                        # Recover once: close the stalled instance (e.g. an
                        # error dialog at startup) and launch again.
                        stage('CS2 did not start; trying again')
                        inst.close()
                        inst = launcher.Instance(state_dir)
                        inst.launch(req.get('profile', 'capture') or None, tuple(req.get('size') or (1280, 720)))
                        win = inst.wait_window()
                        end = time.time() + 180
                        while not os.path.exists(LOG) and time.time() < end:
                            time.sleep(0.5)
                        Log(tail=10_000_000).wait(r'CSGO_GAME_UI_STATE_MAINMENU', 0, 180, 'cs2_start', 'CS2 did not reach the main menu after a retry.')
                    time.sleep(3)
                timings['menu'] = round(time.time() - t0, 3)
                stage('Focusing the CS2 window')
                import ukeys
                how = ukeys.focus_window(win)
                if not how:
                    raise CaptureError('focus', 'CS2 could not be given keyboard focus (another window may be on top of it).')
                timings['focus'] = round(time.time() - t0, 3)
                d = Driver(win, short_forward=int(req.get('short_forward', 0)), timescale=float(req.get('timescale', 1)), paste=bool(req.get('paste', True)), state_dir=state_dir)
                d.nav = req.get('nav', 'seek')
                reply(req, ok=True, pid=inst.pid, launched=inst.launched, focus=how, size=list(xc.window_rect(win)[2:]), timings=timings)
            elif op == 'load':
                stage('Loading the demo in CS2')
                t0 = time.time()
                loaded = d.load_demo(req['demo'])
                reply(req, ok=True, loaded=loaded, timings={'demo_load': round(time.time() - t0, 3)})
            elif op == 'segment':
                # One recording pass cut into the requested clips (Phase 14).
                timer = Timer()
                t0 = time.time()
                outs = d.record_segment(req, float(req.get('tickrate') or 64), timer)
                enc, bad = d.drain_encoded()
                reply(req, ok=True, outputs=outs, encoded=enc, encode_failed=bad, timings={**timer.t, 'wall': round(time.time() - t0, 3)},
                      console=dict(d.con.stats), paste_failures=list(d.paste_failures))
            elif op == 'lineup':
                timer = Timer()
                t0 = time.time()
                d.set_view(False)
                shot = d.shot(int(req['tick']), req['player'], req['file'], width=int(req.get('width') or 0), timer=timer)
                enc, bad = d.drain_encoded()
                reply(req, ok=True, still=shot, encoded=enc, encode_failed=bad, timings={**timer.t, 'wall': round(time.time() - t0, 3)})
            elif op == 'flush':
                t0 = time.time()
                d.finish_encoders(0)
                enc, bad = d.drain_encoded()
                reply(req, ok=True, encoded=enc, encode_failed=bad, timings={'encode_wait': round(time.time() - t0, 3)},
                      console=dict(d.con.stats), paste_failures=list(d.paste_failures))
            elif op == 'kill':
                reply(req, ok=True, **kill_event(d, {'nav': d.nav, **req}))
            elif op == 'utility':
                reply(req, ok=True, **utility_event(d, {'nav': d.nav, **req}))
            elif op == 'watch':
                keep_open = True
                reply(req, ok=True, **watch(d, req, saved))
            elif op == 'set':
                if 'short_forward' in req:
                    d.short_forward = int(req['short_forward'])
                if 'timescale' in req:
                    d.timescale = float(req['timescale'])
                if 'nav' in req:
                    d.nav = req['nav']
                reply(req, ok=True)
            elif op == 'close':
                break
            else:
                raise CaptureError('bad_job', f'Unknown op {op}.')
        except CaptureError as e:
            # Keep evidence of the failure (CS2's console.log is deleted at
            # cleanup): the log tail and the current frame, in the session's
            # state folder.
            try:
                if d and inst:
                    ev = os.path.join(inst.state_dir, 'failures')
                    os.makedirs(ev, exist_ok=True)
                    stamp = time.strftime('%Y%m%d-%H%M%S')
                    with open(os.path.join(ev, f'{stamp}-{op}-{e.code}.log'), 'w') as f:
                        f.write(f'{e.code}: {e}\nrequest: {json.dumps(req)[:2000]}\n\n' + '\n'.join(d.log.read().splitlines()[-200:]))
                    d.frame(1280).save(os.path.join(ev, f'{stamp}-{op}-{e.code}.jpg'), quality=80)
            except Exception:  # noqa: BLE001 - evidence is best effort
                pass
            reply(req, ok=False, code=e.code, error=str(e))
        except Exception as e:  # noqa: BLE001 - reported to the server, not swallowed
            reply(req, ok=False, code='internal', error=f'{type(e).__name__}: {e}')
    # Close: restore the player's settings; quit CS2 if this session started it
    # (unless it was opened for watching). Interrupts can't cut this short.
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    t0 = time.time()
    if d and not keep_open:
        try:
            if inst and inst.alive():
                d.restore(saved)
        except CaptureError:
            pass
    if inst:
        if keep_open:
            pass  # restored in watch(); files are restored when it exits (next session's recover)
        else:
            def send_quit():
                d.cmd('quit', settle=0)
            inst.close(send_quit if d else None)
    if d:
        d.close()
    emit({'closed': True, 'kept_open': keep_open, 'timings': {'close': round(time.time() - t0, 3)}})


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'status':
        print(json.dumps(status()))
        return
    if mode == 'session':
        session()
        return
    sys.exit(__doc__)


if __name__ == '__main__':
    main()
