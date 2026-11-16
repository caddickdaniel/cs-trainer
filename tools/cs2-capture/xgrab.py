"""Reads the CS2 window's pixels through XWayland (XGetImage on its X11
window). CS2 presents through XWayland, so this returns the rendered game
frame exactly as shown, without a screen-recording portal."""
import ctypes

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
