"""Reads the CS2 window's pixels through XWayland (XGetImage on its X11
window). CS2 presents through XWayland, so this returns the rendered game
frame exactly as shown, without a screen-recording portal."""
import ctypes
import ctypes.util

from PIL import Image

import xconsole as xc

x11 = xc.x11


class XWindowAttributes(ctypes.Structure):
    _fields_ = [('x', ctypes.c_int), ('y', ctypes.c_int), ('width', ctypes.c_int), ('height', ctypes.c_int),
                ('border_width', ctypes.c_int), ('depth', ctypes.c_int), ('visual', ctypes.c_void_p), ('root', ctypes.c_ulong),
                ('class_', ctypes.c_int), ('bit_gravity', ctypes.c_int), ('win_gravity', ctypes.c_int), ('backing_store', ctypes.c_int),
                ('backing_planes', ctypes.c_ulong), ('backing_pixel', ctypes.c_ulong), ('save_under', ctypes.c_int),
                ('colormap', ctypes.c_ulong), ('map_installed', ctypes.c_int), ('map_state', ctypes.c_int),
                ('all_event_masks', ctypes.c_long), ('your_event_mask', ctypes.c_long), ('do_not_propagate_mask', ctypes.c_long),
                ('override_redirect', ctypes.c_int), ('screen', ctypes.c_void_p)]


class XImage(ctypes.Structure):
    _fields_ = [('width', ctypes.c_int), ('height', ctypes.c_int), ('xoffset', ctypes.c_int), ('format', ctypes.c_int),
                ('data', ctypes.POINTER(ctypes.c_ubyte)), ('byte_order', ctypes.c_int), ('bitmap_unit', ctypes.c_int),
                ('bitmap_bit_order', ctypes.c_int), ('bitmap_pad', ctypes.c_int), ('depth', ctypes.c_int),
                ('bytes_per_line', ctypes.c_int), ('bits_per_pixel', ctypes.c_int)]


x11.XGetWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XWindowAttributes)]
x11.XGetImage.restype = ctypes.POINTER(XImage)
x11.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
x11.XDestroyImage = getattr(x11, 'XDestroyImage', None)
ZPixmap = 2


def size(win):
    a = XWindowAttributes()
    if not x11.XGetWindowAttributes(xc.dpy, win, ctypes.byref(a)):
        raise RuntimeError('CS2 window is gone')
    return a.width, a.height


def grab(win, width=1280):
    """The window's current frame, scaled to `width` (aspect kept), as RGB."""
    w, h = size(win)
    img = x11.XGetImage(xc.dpy, win, 0, 0, w, h, 0xFFFFFFFF, ZPixmap)
    if not img:
        raise RuntimeError('Could not read the CS2 window')
    im = img.contents
    try:
        if im.bits_per_pixel != 32:
            raise RuntimeError(f'Unsupported pixel format ({im.bits_per_pixel} bpp)')
        raw = ctypes.string_at(im.data, im.bytes_per_line * im.height)
        frame = Image.frombuffer('RGB', (im.width, im.height), raw, 'raw', 'BGRX', im.bytes_per_line, 1)
        frame = frame.copy()  # detach from the X buffer before it's freed
    finally:
        # XDestroyImage is a macro; free the struct's data and the struct.
        x11.XFree(ctypes.cast(im.data, ctypes.c_void_p))
        x11.XFree(ctypes.cast(img, ctypes.c_void_p))
    if width and frame.width != width:
        factor = frame.width // width
        if factor >= 2 and frame.width % factor == 0 and frame.height % factor == 0:
            frame = frame.reduce(factor)
        if frame.width != width:
            frame = frame.resize((width, round(frame.height * width / frame.width)), Image.LANCZOS)
    return frame


# ---- MIT-SHM (Phase 15) -----------------------------------------------------
# XShmGetImage writes the window's pixels into shared memory instead of
# sending them over the X connection, which roughly doubles how many frames
# per second can be read (needed to sample 60 grabs/s while CS2 plays a demo
# at 2x). Falls back to grab() when the extension isn't available.
libc = ctypes.CDLL(None, use_errno=True)
libc.shmget.argtypes = [ctypes.c_int, ctypes.c_size_t, ctypes.c_int]
libc.shmat.restype = ctypes.c_void_p
libc.shmat.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
libc.shmdt.argtypes = [ctypes.c_void_p]
libc.shmctl.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
IPC_PRIVATE, IPC_CREAT, IPC_RMID = 0, 0o1000, 0


class XShmSegmentInfo(ctypes.Structure):
    _fields_ = [('shmseg', ctypes.c_ulong), ('shmid', ctypes.c_int), ('shmaddr', ctypes.c_void_p), ('readOnly', ctypes.c_int)]


try:
    xext = ctypes.CDLL(ctypes.util.find_library('Xext'))
    xext.XShmQueryExtension.argtypes = [ctypes.c_void_p]
    xext.XShmCreateImage.restype = ctypes.POINTER(XImage)
    xext.XShmCreateImage.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_void_p,
                                     ctypes.POINTER(XShmSegmentInfo), ctypes.c_uint, ctypes.c_uint]
    xext.XShmAttach.argtypes = [ctypes.c_void_p, ctypes.POINTER(XShmSegmentInfo)]
    xext.XShmDetach.argtypes = [ctypes.c_void_p, ctypes.POINTER(XShmSegmentInfo)]
    xext.XShmGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XImage), ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
except (OSError, AttributeError, TypeError):
    xext = None


class ShmGrabber:
    """Reuses one shared-memory image for a window of a fixed size."""

    def __init__(self, win):
        if not xext or not xext.XShmQueryExtension(xc.dpy):
            raise RuntimeError('MIT-SHM is not available')
        a = XWindowAttributes()
        if not x11.XGetWindowAttributes(xc.dpy, win, ctypes.byref(a)):
            raise RuntimeError('CS2 window is gone')
        self.win, self.w, self.h = win, a.width, a.height
        self.info = XShmSegmentInfo()
        self.img = xext.XShmCreateImage(xc.dpy, a.visual, a.depth, ZPixmap, None, ctypes.byref(self.info), a.width, a.height)
        if not self.img:
            raise RuntimeError('XShmCreateImage failed')
        im = self.img.contents
        if im.bits_per_pixel != 32:
            raise RuntimeError(f'Unsupported pixel format ({im.bits_per_pixel} bpp)')
        self.size = im.bytes_per_line * im.height
        self.info.shmid = libc.shmget(IPC_PRIVATE, self.size, IPC_CREAT | 0o600)
        if self.info.shmid < 0:
            raise RuntimeError('shmget failed')
        addr = libc.shmat(self.info.shmid, None, 0)
        if addr in (None, ctypes.c_void_p(-1).value):
            libc.shmctl(self.info.shmid, IPC_RMID, None)
            raise RuntimeError('shmat failed')
        self.info.shmaddr = addr
        self.info.readOnly = 0
        im.data = ctypes.cast(addr, ctypes.POINTER(ctypes.c_ubyte))
        if not xext.XShmAttach(xc.dpy, ctypes.byref(self.info)):
            self.close()
            raise RuntimeError('XShmAttach failed')
        x11.XSync(xc.dpy, 0)
        # Marked for removal now; it stays until both sides detach.
        libc.shmctl(self.info.shmid, IPC_RMID, None)
        self.attached = True

    def grab(self, width=1280):
        if not xext.XShmGetImage(xc.dpy, self.win, self.img, 0, 0, 0xFFFFFFFF):
            raise RuntimeError('Could not read the CS2 window')
        im = self.img.contents
        raw = ctypes.string_at(self.info.shmaddr, self.size)
        frame = Image.frombuffer('RGB', (self.w, self.h), raw, 'raw', 'BGRX', im.bytes_per_line, 1)
        if width and frame.width != width:
            frame = frame.resize((width, round(frame.height * width / frame.width)), Image.BILINEAR)
        return frame

    def close(self):
        if getattr(self, 'attached', False):
            xext.XShmDetach(xc.dpy, ctypes.byref(self.info))
            x11.XSync(xc.dpy, 0)
            self.attached = False
        if self.info.shmaddr:
            libc.shmdt(self.info.shmaddr)
            self.info.shmaddr = None
        if self.img:
            x11.XFree(ctypes.cast(self.img, ctypes.c_void_p))
            self.img = None
