#!/usr/bin/env python3
"""X11 CLIPBOARD for pasting commands into CS2 (an XWayland client).

No clipboard tools (xclip, wl-copy) are installed, so this owns the X
CLIPBOARD selection itself and answers paste requests (TARGETS,
UTF8_STRING, STRING, TEXT). It can also read the current clipboard text
(XWayland bridges the Wayland clipboard to X) so it can be put back
afterwards: `xclip.py restore` keeps serving the saved text in the
background until something else is copied.

Only text is saved and restored; other clipboard contents (images, files)
can't be read back this way.
"""
import ctypes
import ctypes.util
import os
import sys
import threading
import time

x11 = ctypes.CDLL(ctypes.util.find_library('X11'))
x11.XInitThreads()
VP, UL, INT = ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int
x11.XOpenDisplay.restype = VP
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.restype = UL
x11.XDefaultRootWindow.argtypes = [VP]
x11.XCreateSimpleWindow.restype = UL
x11.XCreateSimpleWindow.argtypes = [VP, UL, INT, INT, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, UL, UL]
x11.XInternAtom.restype = UL
x11.XInternAtom.argtypes = [VP, ctypes.c_char_p, INT]
x11.XSetSelectionOwner.argtypes = [VP, UL, UL, UL]
x11.XGetSelectionOwner.restype = UL
x11.XGetSelectionOwner.argtypes = [VP, UL]
x11.XConvertSelection.argtypes = [VP, UL, UL, UL, UL, UL]
x11.XFlush.argtypes = [VP]
x11.XPending.argtypes = [VP]
x11.XNextEvent.argtypes = [VP, VP]
x11.XChangeProperty.argtypes = [VP, UL, UL, UL, INT, INT, VP, INT]
x11.XSendEvent.argtypes = [VP, UL, INT, ctypes.c_long, VP]
x11.XGetWindowProperty.argtypes = [VP, UL, UL, ctypes.c_long, ctypes.c_long, INT, UL, ctypes.POINTER(UL), ctypes.POINTER(INT),
                                   ctypes.POINTER(UL), ctypes.POINTER(UL), ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
x11.XFree.argtypes = [VP]
x11.XDestroyWindow.argtypes = [VP, UL]
x11.XCloseDisplay.argtypes = [VP]

SelectionClear, SelectionRequest, SelectionNotify = 29, 30, 31
CurrentTime = 0
XA_ATOM, XA_STRING = 4, 31


class XSelectionRequestEvent(ctypes.Structure):
    _fields_ = [('type', INT), ('serial', UL), ('send_event', INT), ('display', VP), ('owner', UL), ('requestor', UL),
                ('selection', UL), ('target', UL), ('property', UL), ('time', UL)]


class XSelectionEvent(ctypes.Structure):
    _fields_ = [('type', INT), ('serial', UL), ('send_event', INT), ('display', VP), ('requestor', UL),
                ('selection', UL), ('target', UL), ('property', UL), ('time', UL)]


class XEvent(ctypes.Union):
    _fields_ = [('type', INT), ('xselectionrequest', XSelectionRequestEvent), ('xselection', XSelectionEvent), ('pad', ctypes.c_long * 24)]


def _atoms(dpy):
    a = lambda n: x11.XInternAtom(dpy, n, 0)  # noqa: E731
    return {'CLIPBOARD': a(b'CLIPBOARD'), 'UTF8_STRING': a(b'UTF8_STRING'), 'TARGETS': a(b'TARGETS'), 'TEXT': a(b'TEXT'),
            'PROP': a(b'CSTRAINER_CLIP')}


def get_text(timeout=1.0):
    """The current clipboard text, or None (empty, not text, or no answer)."""
    dpy = x11.XOpenDisplay(None)
    if not dpy:
        return None
    try:
        at = _atoms(dpy)
        if not x11.XGetSelectionOwner(dpy, at['CLIPBOARD']):
            return None
        win = x11.XCreateSimpleWindow(dpy, x11.XDefaultRootWindow(dpy), 0, 0, 1, 1, 0, 0, 0)
        x11.XConvertSelection(dpy, at['CLIPBOARD'], at['UTF8_STRING'], at['PROP'], win, CurrentTime)
        x11.XFlush(dpy)
        ev = XEvent()
        end = time.time() + timeout
        while time.time() < end:
            if x11.XPending(dpy):
                x11.XNextEvent(dpy, ctypes.byref(ev))
                if ev.type == SelectionNotify:
                    if not ev.xselection.property:
                        return None
                    typ, fmt, n, left = UL(), INT(), UL(), UL()
                    data = ctypes.POINTER(ctypes.c_ubyte)()
                    x11.XGetWindowProperty(dpy, win, at['PROP'], 0, 1 << 20, 1, 0, ctypes.byref(typ), ctypes.byref(fmt),
                                           ctypes.byref(n), ctypes.byref(left), ctypes.byref(data))
                    if not data:
                        return None
                    text = ctypes.string_at(data, n.value).decode('utf-8', 'replace')
                    x11.XFree(data)
                    return text
            else:
                time.sleep(0.01)
        return None
    finally:
        x11.XCloseDisplay(dpy)


class Owner:
    """Owns CLIPBOARD and serves `text` to paste requests from a thread."""

    def __init__(self):
        self.dpy = x11.XOpenDisplay(None)
        if not self.dpy:
            raise RuntimeError('Cannot open the X display')
        self.at = _atoms(self.dpy)
        self.win = x11.XCreateSimpleWindow(self.dpy, x11.XDefaultRootWindow(self.dpy), 0, 0, 1, 1, 0, 0, 0)
        self.text = b''
        self.served = 0
        self.lost = False
        self._stop = False
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def set(self, text):
        with self.lock:
            self.text = text.encode('utf-8')
            self.lost = False
            x11.XSetSelectionOwner(self.dpy, self.at['CLIPBOARD'], self.win, CurrentTime)
            x11.XFlush(self.dpy)
            ok = x11.XGetSelectionOwner(self.dpy, self.at['CLIPBOARD']) == self.win
        return ok

    def _loop(self):
        ev = XEvent()
        while not self._stop:
            with self.lock:
                pending = x11.XPending(self.dpy)
                if pending:
                    x11.XNextEvent(self.dpy, ctypes.byref(ev))
                    self._handle(ev)
            if not pending:
                time.sleep(0.003)

    def _handle(self, ev):
        if ev.type == SelectionClear:
            self.lost = True
            return
        if ev.type != SelectionRequest:
            return
        r = ev.xselectionrequest
        prop = r.property or r.target
        at = self.at
        if r.target == at['TARGETS']:
            targets = (UL * 4)(at['TARGETS'], at['UTF8_STRING'], XA_STRING, at['TEXT'])
            x11.XChangeProperty(self.dpy, r.requestor, prop, XA_ATOM, 32, 0, ctypes.cast(targets, VP), 4)
        elif r.target in (at['UTF8_STRING'], XA_STRING, at['TEXT']):
            buf = ctypes.create_string_buffer(self.text)
            x11.XChangeProperty(self.dpy, r.requestor, prop, r.target if r.target != at['TEXT'] else at['UTF8_STRING'], 8, 0,
                                ctypes.cast(buf, VP), len(self.text))
            self.served += 1
        else:
            prop = 0
        out = XEvent()
        out.xselection.type = SelectionNotify
        out.xselection.requestor = r.requestor
        out.xselection.selection = r.selection
        out.xselection.target = r.target
        out.xselection.property = prop
        out.xselection.time = r.time
        x11.XSendEvent(self.dpy, r.requestor, 0, 0, ctypes.byref(out))
        x11.XFlush(self.dpy)

    def close(self):
        self._stop = True
        self.thread.join(timeout=1)
        x11.XDestroyWindow(self.dpy, self.win)
        x11.XCloseDisplay(self.dpy)


def restore_detached(text):
    """Puts saved clipboard text back: a detached helper serves it until
    something else is copied (then exits)."""
    if text is None:
        return False
    import subprocess
    p = subprocess.Popen([sys.executable, '-I', os.path.abspath(__file__), 'serve'], stdin=subprocess.PIPE,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    p.stdin.write(text.encode('utf-8'))
    p.stdin.close()
    return True


def _serve_stdin():
    text = sys.stdin.buffer.read().decode('utf-8', 'replace')
    o = Owner()
    o.set(text)
    # Serve until another program takes the clipboard (or a day passes).
    end = time.time() + 86400
    while not o.lost and time.time() < end:
        time.sleep(0.2)
    o.close()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'serve':
        _serve_stdin()
    elif len(sys.argv) > 1 and sys.argv[1] == 'get':
        print(repr(get_text()))
