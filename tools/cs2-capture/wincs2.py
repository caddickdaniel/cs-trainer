"""Windows counterparts of the Linux helpers (xconsole.py, xgrab.py, ukeys.py,
xclip.py) used by capture.py and launcher.py, with the same interfaces.

- window: CS2's top-level window (process cs2.exe), its client rectangle in
  physical desktop pixels (the process is per-monitor DPI aware), and focus.
- frames: CS2 presents through DirectX, whose buffers GDI can't read from the
  window itself, so frames are copied from the desktop at the window's client
  rectangle (DWM composes windowed CS2 there). CS2 must be visible and on top,
  which capture needs anyway because it types into the focused window.
- keyboard: SendInput with hardware scan codes (games ignore KEYEVENTF_UNICODE).
  The key codes capture.py passes are Linux evdev codes; for the keys it uses
  (Esc, Backspace, Enter, Ctrl, A, V, grave) they equal PC set-1 scan codes.
- clipboard: the player's text is saved and put back; Windows keeps clipboard
  data after this process exits, so nothing has to keep serving it.
"""
import ctypes
import ctypes.wintypes as wt
import os
import time

from PIL import Image

user32 = ctypes.WinDLL('user32', use_last_error=True)
gdi32 = ctypes.WinDLL('gdi32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

# Physical pixels everywhere (window rects, cursor, BitBlt) on scaled displays.
try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
except (AttributeError, OSError):
    try:
        ctypes.WinDLL('shcore').SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        user32.SetProcessDPIAware()

HWND = wt.HWND
user32.GetForegroundWindow.restype = HWND
user32.WindowFromPoint.restype = HWND
user32.WindowFromPoint.argtypes = [wt.POINT]
user32.GetAncestor.restype = HWND
user32.GetAncestor.argtypes = [HWND, ctypes.c_uint]
user32.GetDC.restype = wt.HDC
user32.GetDC.argtypes = [HWND]
user32.ReleaseDC.argtypes = [HWND, wt.HDC]
user32.IsWindow.argtypes = [HWND]
user32.IsWindowVisible.argtypes = [HWND]
user32.IsIconic.argtypes = [HWND]
user32.GetClientRect.argtypes = [HWND, ctypes.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [HWND, ctypes.POINTER(wt.POINT)]
user32.GetWindowThreadProcessId.argtypes = [HWND, ctypes.POINTER(wt.DWORD)]
user32.SetForegroundWindow.argtypes = [HWND]
user32.BringWindowToTop.argtypes = [HWND]
user32.ShowWindow.argtypes = [HWND, ctypes.c_int]
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
gdi32.CreateCompatibleDC.restype = wt.HDC
gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
gdi32.CreateDIBSection.restype = wt.HBITMAP
gdi32.CreateDIBSection.argtypes = [wt.HDC, ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p), wt.HANDLE, wt.DWORD]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.BitBlt.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HDC, ctypes.c_int, ctypes.c_int, wt.DWORD]
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wt.HDC]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD)]
kernel32.GetCurrentThreadId.restype = wt.DWORD

GA_ROOT = 2
SRCCOPY, CAPTUREBLT = 0x00CC0020, 0x40000000
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


# ---- window ------------------------------------------------------------------

def _process_name(pid):
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return ''
    try:
        buf = ctypes.create_unicode_buffer(1024)
        n = wt.DWORD(len(buf))
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            return os.path.basename(buf.value).lower()
        return ''
    finally:
        kernel32.CloseHandle(h)


def window_pid(hwnd):
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def find_cs2(win=None):
    """CS2's visible top-level window (largest, if it has several), or None."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, HWND, wt.LPARAM)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd) and _process_name(window_pid(hwnd)) == 'cs2.exe':
            r = wt.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(r))
            if r.right > 0 and r.bottom > 0:
                found.append((r.right * r.bottom, hwnd))
        return True

    user32.EnumWindows(each, 0)
    return max(found)[1] if found else None


def window_rect(win):
    """(x, y, w, h) of the client area in desktop coordinates."""
    if not user32.IsWindow(win):
        return None
    r = wt.RECT()
    user32.GetClientRect(win, ctypes.byref(r))
    p = wt.POINT(0, 0)
    user32.ClientToScreen(win, ctypes.byref(p))
    return p.x, p.y, r.right, r.bottom


def screen_size():
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def focused():
    return user32.GetForegroundWindow()


def descendants(win):  # noqa: ARG001 - CS2 takes input in its top-level window
    return []


def _root_at(x, y):
    h = user32.WindowFromPoint(wt.POINT(x, y))
    return user32.GetAncestor(h, GA_ROOT) if h else None


# ---- frames --------------------------------------------------------------------

class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [('biSize', wt.DWORD), ('biWidth', ctypes.c_long), ('biHeight', ctypes.c_long), ('biPlanes', wt.WORD),
                ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD), ('biXPelsPerMeter', ctypes.c_long),
                ('biYPelsPerMeter', ctypes.c_long), ('biClrUsed', wt.DWORD), ('biClrImportant', wt.DWORD)]


def size(win):
    r = window_rect(win)
    if not r:
        raise RuntimeError('CS2 window is gone')
    return r[2], r[3]


def _scale(frame, width, quality):
    if width and frame.width != width:
        factor = frame.width // width
        if factor >= 2 and frame.width % factor == 0 and frame.height % factor == 0:
            frame = frame.reduce(factor)
        if frame.width != width:
            frame = frame.resize((width, round(frame.height * width / frame.width)), quality)
    return frame


class ShmGrabber:
    """Reuses one DIB section for a window of a fixed size (the fast path,
    like the Linux shared-memory grabber)."""

    def __init__(self, win):
        r = window_rect(win)
        if not r or r[2] <= 0 or r[3] <= 0:
            raise RuntimeError('CS2 window is gone')
        self.win, self.w, self.h = win, r[2], r[3]
        self.screen = user32.GetDC(None)
        self.mem = gdi32.CreateCompatibleDC(self.screen)
        bmi = _BITMAPINFOHEADER(ctypes.sizeof(_BITMAPINFOHEADER), self.w, -self.h, 1, 32, 0, 0, 0, 0, 0, 0)
        self.bits = ctypes.c_void_p()
        self.bmp = gdi32.CreateDIBSection(self.mem, ctypes.byref(bmi), 0, ctypes.byref(self.bits), None, 0)
        if not self.bmp:
            self.close()
            raise RuntimeError('CreateDIBSection failed')
        self.old = gdi32.SelectObject(self.mem, self.bmp)
        self.nbytes = self.w * self.h * 4

    def grab(self, width=1280):
        r = window_rect(self.win)
        if not r:
            raise RuntimeError('Could not read the CS2 window')
        if not gdi32.BitBlt(self.mem, 0, 0, self.w, self.h, self.screen, r[0], r[1], SRCCOPY):
            raise RuntimeError('Could not read the CS2 window')
        raw = ctypes.string_at(self.bits, self.nbytes)
        frame = Image.frombuffer('RGB', (self.w, self.h), raw, 'raw', 'BGRX', self.w * 4, 1)
        return _scale(frame, width, Image.BILINEAR) if width and width != self.w else frame.copy()

    def close(self):
        if getattr(self, 'old', None):
            gdi32.SelectObject(self.mem, self.old)
            self.old = None
        if getattr(self, 'bmp', None):
            gdi32.DeleteObject(self.bmp)
            self.bmp = None
        if getattr(self, 'mem', None):
            gdi32.DeleteDC(self.mem)
            self.mem = None
        if getattr(self, 'screen', None):
            user32.ReleaseDC(None, self.screen)
            self.screen = None


def grab(win, width=1280):
    """The window's current frame, scaled to `width` (aspect kept), as RGB."""
    g = ShmGrabber(win)
    try:
        frame = g.grab(0)
    finally:
        g.close()
    return _scale(frame, width, Image.LANCZOS)


# ---- keyboard and mouse --------------------------------------------------------

ULONG_PTR = ctypes.c_size_t


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', wt.WORD), ('wScan', wt.WORD), ('dwFlags', wt.DWORD), ('time', wt.DWORD), ('dwExtraInfo', ULONG_PTR)]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [('dx', ctypes.c_long), ('dy', ctypes.c_long), ('mouseData', wt.DWORD), ('dwFlags', wt.DWORD),
                ('time', wt.DWORD), ('dwExtraInfo', ULONG_PTR)]


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = [('uMsg', wt.DWORD), ('wParamL', wt.WORD), ('wParamH', wt.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [('ki', _KEYBDINPUT), ('mi', _MOUSEINPUT), ('hi', _HARDWAREINPUT)]


class _INPUT(ctypes.Structure):
    _fields_ = [('type', wt.DWORD), ('u', _INPUTUNION)]


user32.SendInput.argtypes = [ctypes.c_uint, ctypes.POINTER(_INPUT), ctypes.c_int]
INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x0002, 0x0008
MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
SC_LSHIFT = 42


def _send(*inputs):
    arr = (_INPUT * len(inputs))(*inputs)
    if user32.SendInput(len(inputs), arr, ctypes.sizeof(_INPUT)) != len(inputs):
        raise OSError(ctypes.get_last_error(), 'SendInput was blocked')


def _key(code, up=False):
    i = _INPUT(type=INPUT_KEYBOARD)
    i.u.ki = _KEYBDINPUT(0, code, KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0), 0, 0)
    return i


class Keyboard:
    """Scan-code keyboard with the same calls as ukeys.Keyboard."""

    def tap(self, code, shift=False):
        if shift:
            _send(_key(SC_LSHIFT))
            time.sleep(0.004)
        _send(_key(code))
        time.sleep(0.004)
        _send(_key(code, True))
        if shift:
            time.sleep(0.004)
            _send(_key(SC_LSHIFT, True))
        time.sleep(0.004)

    def down(self, code):
        _send(_key(code))

    def up(self, code):
        _send(_key(code, True))

    def close(self):
        pass


def click_at(x, y):
    user32.SetCursorPos(x, y)
    time.sleep(0.05)
    down, up = _INPUT(type=INPUT_MOUSE), _INPUT(type=INPUT_MOUSE)
    down.u.mi = _MOUSEINPUT(0, 0, 0, MOUSEEVENTF_LEFTDOWN, 0, 0)
    up.u.mi = _MOUSEINPUT(0, 0, 0, MOUSEEVENTF_LEFTUP, 0, 0)
    _send(down)
    time.sleep(0.05)
    _send(up)


def activate(win):
    """Brings the window to the front. Windows only lets the foreground
    process hand over focus, so this briefly joins the foreground thread's
    input queue (the documented way for a helper to do it)."""
    if user32.IsIconic(win):
        user32.ShowWindow(win, 9)  # SW_RESTORE
    fg = user32.GetForegroundWindow()
    me = kernel32.GetCurrentThreadId()
    other = user32.GetWindowThreadProcessId(fg, None) if fg else 0
    attached = bool(other and other != me and user32.AttachThreadInput(me, other, True))
    try:
        user32.BringWindowToTop(win)
        user32.SetForegroundWindow(win)
    finally:
        if attached:
            user32.AttachThreadInput(me, other, False)


def focus_window(win, attempts=3):
    """Gives CS2 keyboard focus without the user: activation first, then a
    click at the window centre, but only once that point is confirmed to be on
    CS2 (nothing on top of it). Returns how, or None."""
    if focused() == win:
        return 'already'
    activate(win)
    time.sleep(0.6)
    if focused() == win:
        return 'activate'
    for _ in range(attempts):
        rect = window_rect(win)
        if not rect:
            return None
        x, y, w, h = rect
        cx, cy = x + w // 2, y + h // 2
        if _root_at(cx, cy) == win:
            click_at(cx, cy)
            time.sleep(0.6)
            if focused() == win:
                return 'click'
        time.sleep(1.0)
    return None


user32.VkKeyScanW.restype = ctypes.c_short
user32.VkKeyScanW.argtypes = [wt.WCHAR]
user32.MapVirtualKeyW.argtypes = [ctypes.c_uint, ctypes.c_uint]


def char_key(ch):
    """(scan code, shift) for a character in the active keyboard layout."""
    r = user32.VkKeyScanW(ch)
    if r == -1:
        raise ValueError(f'No key for {ch!r} in the active keyboard layout')
    vk, mods = r & 0xFF, (r >> 8) & 0xFF
    if mods & ~1:
        raise ValueError(f'{ch!r} needs Ctrl or Alt in the active keyboard layout')
    sc = user32.MapVirtualKeyW(vk, 0)  # MAPVK_VK_TO_VSC
    if not sc:
        raise ValueError(f'No scan code for {ch!r}')
    return sc, bool(mods & 1)


# ---- clipboard ------------------------------------------------------------------

CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
user32.OpenClipboard.argtypes = [HWND]
user32.GetClipboardData.restype = wt.HANDLE
user32.GetClipboardData.argtypes = [ctypes.c_uint]
user32.SetClipboardData.restype = wt.HANDLE
user32.SetClipboardData.argtypes = [ctypes.c_uint, wt.HANDLE]
kernel32.GlobalAlloc.restype = wt.HGLOBAL
kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [wt.HGLOBAL]
kernel32.GlobalUnlock.argtypes = [wt.HGLOBAL]
kernel32.GlobalFree.argtypes = [wt.HGLOBAL]


def _open_clipboard(timeout=1.0):
    end = time.time() + timeout
    while not user32.OpenClipboard(None):
        if time.time() > end:
            return False
        time.sleep(0.02)
    return True


def get_text(timeout=1.0):
    """The clipboard's text, or None (empty, or not text)."""
    if not _open_clipboard(timeout):
        raise RuntimeError('clipboard busy')
    try:
        h = user32.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return None
        p = kernel32.GlobalLock(h)
        try:
            return ctypes.wstring_at(p) if p else None
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


def set_text(text):
    if not _open_clipboard():
        return False
    try:
        user32.EmptyClipboard()
        data = ctypes.create_unicode_buffer(text)
        h = kernel32.GlobalAlloc(GMEM_MOVEABLE, ctypes.sizeof(data))
        if not h:
            return False
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, data, ctypes.sizeof(data))
        kernel32.GlobalUnlock(h)
        if not user32.SetClipboardData(CF_UNICODETEXT, h):
            kernel32.GlobalFree(h)
            return False
        return True
    finally:
        user32.CloseClipboard()


class Owner:
    """Same calls as xclip.Owner: set() puts a command on the clipboard."""

    def set(self, text):
        return set_text(text)

    def close(self):
        pass


def restore_detached(text):
    """Puts the player's text back (Windows keeps it after we exit)."""
    if text is not None:
        set_text(text)


# ---- console --------------------------------------------------------------------

class FocusLost(Exception):
    pass


KEY_ESC, KEY_BACKSPACE, KEY_ENTER, KEY_LEFTCTRL, KEY_A, KEY_V, KEY_GRAVE = 1, 14, 28, 29, 30, 47, 41


class Console:
    """Sends commands to the CS2 console while CS2 has focus (same behaviour
    and calls as ukeys.Console: paste with Ctrl+V, type as a fallback, and
    give the player's clipboard back afterwards)."""

    def __init__(self, paste=True, save_to=None):
        self.win = find_cs2()
        if not self.win:
            raise FocusLost('CS2 window not found')
        self.kb = Keyboard()
        self.paste = paste
        self.clip = None
        self.saved_clipboard = None
        self.save_to = save_to
        self.stats = {'pasted': 0, 'typed': 0, 'paste_fallbacks': 0, 'submit_s': 0.0}
        if paste:
            try:
                self.saved_clipboard = get_text()
                if save_to and self.saved_clipboard is not None:
                    with open(save_to, 'w', encoding='utf-8') as f:
                        f.write(self.saved_clipboard)
                self.clip = Owner()
            except Exception:  # noqa: BLE001 - no clipboard: type instead
                self.paste = False

    def has_focus(self):
        return focused() == self.win

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

    def key(self, code):
        if not self.has_focus():
            raise FocusLost('CS2 is not focused')
        self.kb.tap(code)

    def _chord(self, mod, code):
        self.kb.down(mod)
        time.sleep(0.006)
        self.kb.tap(code)
        self.kb.up(mod)
        time.sleep(0.006)

    def run(self, cmd, typed=False):
        """Submits one console command. Returns 'paste' or 'type'."""
        t0 = time.time()
        if not self.has_focus():
            raise FocusLost('CS2 is not focused')
        if self.paste and not typed and self.clip and self.clip.set(cmd):
            self._chord(KEY_LEFTCTRL, KEY_V)
            self.kb.tap(KEY_ENTER)
            self.stats['pasted'] += 1
            how = 'paste'
        else:
            keys = [char_key(c) for c in cmd]  # validate before typing anything
            for code, shift in keys:
                self.kb.tap(code, shift)
            self.kb.tap(KEY_ENTER)
            self.stats['typed'] += 1
            how = 'type'
        self.stats['submit_s'] = round(self.stats['submit_s'] + time.time() - t0, 3)
        return how

    def clear_line(self):
        self._chord(KEY_LEFTCTRL, KEY_A)
        self.kb.tap(KEY_BACKSPACE)

    def restore(self):
        if self.clip:
            self.clip = None
            restore_detached(self.saved_clipboard)
            if self.save_to:
                try:
                    os.remove(self.save_to)
                except OSError:
                    pass

    def close(self):
        self.restore()
        self.kb.close()
