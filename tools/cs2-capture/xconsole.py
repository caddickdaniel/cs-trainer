#!/usr/bin/env python3
"""X11 helpers for the CS2 window (XWayland): find it by WM_CLASS "cs2",
read which window has input focus, and list its child windows.

Used by ukeys.py (focus checks before typing) and xgrab.py (reading the
window's pixels). Its XTest typer (`main`) is kept for X11 sessions only: on
GNOME Wayland, XTest keystrokes never reach the game, which is why capture
types through a uinput virtual keyboard instead.

Usage (X11 sessions): xconsole.py [--open] "cmd 1" "cmd 2" ...
"""
import ctypes
import ctypes.util
import sys
import time

x11 = ctypes.CDLL(ctypes.util.find_library('X11'))
xtst = ctypes.CDLL(ctypes.util.find_library('Xtst'))
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeycodeToKeysym.restype = ctypes.c_ulong
x11.XKeycodeToKeysym.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, ctypes.c_int]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XGetInputFocus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int)]
x11.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
                           ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
x11.XFree.argtypes = [ctypes.c_void_p]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]


class XClassHint(ctypes.Structure):
    _fields_ = [('res_name', ctypes.c_char_p), ('res_class', ctypes.c_char_p)]


x11.XGetClassHint.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XClassHint)]


class XClientMessageEvent(ctypes.Structure):
    _fields_ = [('type', ctypes.c_int), ('serial', ctypes.c_ulong), ('send_event', ctypes.c_int), ('display', ctypes.c_void_p),
                ('window', ctypes.c_ulong), ('message_type', ctypes.c_ulong), ('format', ctypes.c_int), ('data', ctypes.c_long * 5)]


class XEvent(ctypes.Union):
    _fields_ = [('xclient', XClientMessageEvent), ('pad', ctypes.c_long * 24)]


x11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.POINTER(XEvent)]

dpy = x11.XOpenDisplay(None)
if not dpy:
    sys.exit('Cannot open the X display')

# Xlib's default error handler exits the process (e.g. BadWindow when CS2
# closes or crashes); record the error instead so callers can report it.
X_ERRORS = []
_ErrorHandler = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
_on_error = _ErrorHandler(lambda d, e: X_ERRORS.append(1) or 0)
x11.XSetErrorHandler.argtypes = [_ErrorHandler]
x11.XSetErrorHandler(_on_error)
root = x11.XDefaultRootWindow(dpy)


def descendants(win):
    out = []
    for c in children(win):
        out += [c, *descendants(c)]
    return out


def children(win):
    r, p, kids, n = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
    if not x11.XQueryTree(dpy, win, ctypes.byref(r), ctypes.byref(p), ctypes.byref(kids), ctypes.byref(n)):
        return []
    out = [kids[i] for i in range(n.value)]
    if kids:
        x11.XFree(kids)
    return out


def find_cs2(win=None):
    win = root if win is None else win
    hint = XClassHint()
    if x11.XGetClassHint(dpy, win, ctypes.byref(hint)) and hint.res_class == b'cs2':
        return win
    for c in children(win):
        found = find_cs2(c)
        if found:
            return found
    return None


def focused():
    w, rev = ctypes.c_ulong(), ctypes.c_int()
    x11.XGetInputFocus(dpy, ctypes.byref(w), ctypes.byref(rev))
    return w.value


def activate(win):
    ev = XEvent()
    ev.xclient.type = 33  # ClientMessage
    ev.xclient.send_event = 1
    ev.xclient.window = win
    ev.xclient.message_type = x11.XInternAtom(dpy, b'_NET_ACTIVE_WINDOW', 0)
    ev.xclient.format = 32
    ev.xclient.data[0] = 2  # source: pager
    ev.xclient.data[1] = 0
    x11.XSendEvent(dpy, root, 0, (1 << 20) | (1 << 19), ctypes.byref(ev))
    x11.XSync(dpy, 0)


SHIFT = x11.XKeysymToKeycode(dpy, x11.XStringToKeysym(b'Shift_L'))
NAMES = {' ': 'space', '"': 'quotedbl', '_': 'underscore', '/': 'slash', '.': 'period', '-': 'minus', ':': 'colon', ';': 'semicolon',
         '+': 'plus', '=': 'equal', ',': 'comma', '`': 'grave', '\n': 'Return', '\\': 'backslash', '(': 'parenleft', ')': 'parenright'}


def key(name, shift=False):
    code = x11.XKeysymToKeycode(dpy, x11.XStringToKeysym(name.encode()))
    if not code:
        raise SystemExit(f'No keycode for {name}')
    if shift:
        xtst.XTestFakeKeyEvent(dpy, SHIFT, 1, 0)
    xtst.XTestFakeKeyEvent(dpy, code, 1, 0)
    xtst.XTestFakeKeyEvent(dpy, code, 0, 0)
    if shift:
        xtst.XTestFakeKeyEvent(dpy, SHIFT, 0, 0)
    x11.XFlush(dpy)
    time.sleep(0.012)


def type_char(ch):
    name = NAMES.get(ch, ch)
    sym = x11.XStringToKeysym(name.encode())
    code = x11.XKeysymToKeycode(dpy, sym)
    # Shifted when the keysym sits at level 1 of its keycode (e.g. uppercase, _ " :).
    shift = bool(code) and x11.XKeycodeToKeysym(dpy, code, 0) != sym
    key(name, shift)


def main():
    args = sys.argv[1:]
    open_console = '--open' in args
    args = [a for a in args if a != '--open']
    win = find_cs2()
    if not win:
        sys.exit('CS2 window not found')
    activate(win)
    time.sleep(0.6)
    f = focused()
    # Focus may be on the CS2 window itself or one of its children.
    ok = f == win or f in children(win)
    if not ok:
        sys.exit(f'Refusing to type: X focus is on window {hex(f)}, not CS2 ({hex(win)})')
    if open_console:
        key('grave')
        time.sleep(0.4)
    for cmd in args:
        if focused() not in (win, *children(win)):
            sys.exit('Focus left CS2; stopped')
        for ch in cmd:
            type_char(ch)
        key('Return')
        time.sleep(0.3)
    print(f'typed {len(args)} command(s) into CS2 window {hex(win)}')


if __name__ == '__main__':
    main()
