#!/usr/bin/env python3
"""Types CS2 console commands through a kernel virtual keyboard (/dev/uinput).

On GNOME Wayland, XTest keystrokes from X clients never reach games, but a
uinput device is a real input device: the compositor delivers its keys to the
focused window like a physical keyboard. Steam's udev rules
(60-steam-input.rules) give the logged-in user access to /dev/uinput.

Safety: a uinput keyboard types into whatever has focus, so before every
command this checks (through XWayland) that X input focus is on the CS2
window (WM_CLASS "cs2") and stops otherwise. When a Wayland-native window
(terminal, browser) is focused, X focus is not on CS2, so nothing is typed.

Keys are mapped from characters through the active keymap (XWayland keycode
minus 8 is the evdev code), so non-US layouts type the right characters.
"""
import ctypes
import fcntl
import os
import struct
import time

import xconsole as xc

EV_SYN, EV_KEY, SYN_REPORT = 0, 1, 0
UI_SET_EVBIT, UI_SET_KEYBIT = 0x40045564, 0x40045565
UI_DEV_SETUP, UI_DEV_CREATE, UI_DEV_DESTROY = 0x405C5503, 0x5501, 0x5502
KEY_GRAVE, KEY_ENTER, KEY_LEFTSHIFT, KEY_ESC = 41, 28, 42, 1


class Keyboard:
    def __init__(self):
        self.fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        for code in range(1, 249):
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)
        # struct uinput_setup { input_id {bustype, vendor, product, version}; char name[80]; u32 ff_effects_max; }
        setup = struct.pack('HHHH80sI', 0x03, 0x1209, 0xC520, 1, b'cs-trainer capture keyboard', 0)
        fcntl.ioctl(self.fd, UI_DEV_SETUP, setup)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)
        time.sleep(1.0)  # let the compositor pick up the new device

    def _emit(self, typ, code, value):
        os.write(self.fd, struct.pack('llHHi', 0, 0, typ, code, value))

    def tap(self, code, shift=False):
        if shift:
            self._emit(EV_KEY, KEY_LEFTSHIFT, 1)
            self._emit(EV_SYN, SYN_REPORT, 0)
            time.sleep(0.006)
        self._emit(EV_KEY, code, 1)
        self._emit(EV_SYN, SYN_REPORT, 0)
        # Held briefly and spaced out so each press lands in its own game frame.
        time.sleep(0.012)
        self._emit(EV_KEY, code, 0)
        self._emit(EV_SYN, SYN_REPORT, 0)
        if shift:
            time.sleep(0.004)
            self._emit(EV_KEY, KEY_LEFTSHIFT, 0)
            self._emit(EV_SYN, SYN_REPORT, 0)
        time.sleep(0.014)

    def close(self):
        fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        os.close(self.fd)


def char_key(ch):
    name = xc.NAMES.get(ch, ch)
    sym = xc.x11.XStringToKeysym(name.encode())
    code = xc.x11.XKeysymToKeycode(xc.dpy, sym)
    if not code:
        raise ValueError(f'No key for {ch!r} in the active keymap')
    shift = xc.x11.XKeycodeToKeysym(xc.dpy, code, 0) != sym
    return code - 8, shift


class FocusLost(Exception):
    pass


class Console:
    """Types into the CS2 console while CS2 has focus."""

    def __init__(self):
        self.win = xc.find_cs2()
        if not self.win:
            raise FocusLost('CS2 window not found')
        self.kb = Keyboard()

    def has_focus(self):
        f = xc.focused()
        return f == self.win or f in xc.descendants(self.win)

    def wait_focus(self, timeout):
        end = time.time() + timeout
        while time.time() < end:
            if self.has_focus():
                return True
            time.sleep(0.25)
        return False

    def toggle(self):
        if not self.has_focus():
            raise FocusLost('CS2 is not focused')
        self.kb.tap(KEY_GRAVE)
        time.sleep(0.3)

    def run(self, cmd):
        keys = [char_key(c) for c in cmd]  # validate before typing anything
        if not self.has_focus():
            raise FocusLost('CS2 is not focused')
        for code, shift in keys:
            self.kb.tap(code, shift)
        self.kb.tap(KEY_ENTER)
        time.sleep(0.05)

    def close(self):
        self.kb.close()
