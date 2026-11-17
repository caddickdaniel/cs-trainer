"""Platform layer for the capture tool: Linux (XWayland, uinput, /proc,
GStreamer, Steam Linux Runtime) or Windows (wincs2.py, psutil, FFmpeg).
capture.py and launcher.py go through this module for everything that
differs, so their logic is the same on both."""
import os
import shutil
import subprocess
import sys

IS_WIN = sys.platform == 'win32'


# ---- helper modules with the same interfaces on both platforms ----------------

def window():
    """find_cs2(), window_rect(), focused(), descendants()."""
    if IS_WIN:
        import wincs2
        return wincs2
    import xconsole
    return xconsole


def keys():
    """Console, FocusLost, focus_window()."""
    if IS_WIN:
        import wincs2
        return wincs2
    import ukeys
    return ukeys


def frames():
    """grab(), size(), ShmGrabber."""
    if IS_WIN:
        import wincs2
        return wincs2
    import xgrab
    return xgrab


def clipboard():
    """restore_detached()."""
    if IS_WIN:
        import wincs2
        return wincs2
    import xclip
    return xclip


# ---- Steam and CS2 locations --------------------------------------------------

def steam_root():
    if IS_WIN:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam') as k:
                return os.path.normpath(winreg.QueryValueEx(k, 'SteamPath')[0])
        except OSError:
            return os.path.normpath(r'C:\Program Files (x86)\Steam')
    return os.path.expanduser('~/.local/share/Steam')


def cs2_binary_rel():
    """CS2's start file relative to its `game` folder (marks an installed CS2)."""
    return os.path.join('bin', 'win64', 'cs2.exe') if IS_WIN else 'cs2.sh'


def input_ok():
    """Whether this tool can send keys to CS2 (Linux: /dev/uinput access)."""
    return True if IS_WIN else os.access('/dev/uinput', os.W_OK)


# ---- processes ----------------------------------------------------------------

def cs2_pids():
    if IS_WIN:
        import psutil
        return [p.info['pid'] for p in psutil.process_iter(['pid', 'name']) if (p.info['name'] or '').lower() == 'cs2.exe']
    out = subprocess.run(['pgrep', '-x', 'cs2'], capture_output=True, text=True).stdout.split()
    return [int(p) for p in out]


def cmdline(pid):
    if IS_WIN:
        import psutil
        try:
            return ' '.join(psutil.Process(pid).cmdline())
        except (psutil.Error, OSError):
            return ''
    try:
        return open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\0', b' ').decode('utf-8', 'replace')
    except OSError:
        return ''


def environ_has(pid, text):
    if IS_WIN:
        import psutil
        try:
            k, _, v = text.partition('=')
            return psutil.Process(pid).environ().get(k) == v
        except (psutil.Error, OSError):
            return False
    try:
        return text.encode() in open(f'/proc/{pid}/environ', 'rb').read()
    except OSError:
        return False


def alive(pid):
    if not pid:
        return False
    if IS_WIN:
        import psutil
        try:
            p = psutil.Process(pid)
            return p.is_running() and p.status() != psutil.STATUS_ZOMBIE and (p.name() or '').lower() == 'cs2.exe'
        except (psutil.Error, OSError):
            return False
    return os.path.exists(f'/proc/{pid}')


def stop(pid, force=False):
    """Asks the process to end (force: kill it)."""
    if IS_WIN:
        import psutil
        try:
            p = psutil.Process(pid)
            p.kill() if force else p.terminate()
        except (psutil.Error, OSError):
            pass
        return
    import signal
    try:
        os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)
    except OSError:
        pass


def detached_popen_kwargs():
    if IS_WIN:
        return {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS}
    return {'start_new_session': True}


# ---- clip encoder (raw RGB frames on stdin -> WebM/VP8 file) -------------------

def _gstreamer():
    return shutil.which('gst-launch-1.0') and subprocess.run(['gst-inspect-1.0', 'vp8enc'], capture_output=True).returncode == 0


def _ffmpeg():
    exe = shutil.which('ffmpeg')
    if not exe:
        return None
    out = subprocess.run([exe, '-hide_banner', '-encoders'], capture_output=True, text=True).stdout
    return exe if ' libvpx ' in out else None


_encoder = None


def encoder():
    """'gstreamer', 'ffmpeg' or None. GStreamer stays first on Linux (as before)."""
    global _encoder
    if _encoder is None:
        _encoder = ('gstreamer' if not IS_WIN and _gstreamer() else None) or ('ffmpeg' if _ffmpeg() else None) or ''
    return _encoder or None


def encoder_cmd(w, h, fps, file):
    """The same VP8 settings with either tool: realtime deadline, cpu-used 4, 4 Mb/s."""
    if encoder() == 'ffmpeg':
        return [_ffmpeg(), '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-framerate', str(fps),
                '-i', '-', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '4', '-b:v', '4M', '-f', 'webm', file]
    return ['gst-launch-1.0', '-q', 'fdsrc', 'fd=0', '!', 'rawvideoparse', f'width={w}', f'height={h}', 'format=rgb',
            f'framerate={fps}/1', '!', 'videoconvert', '!', 'vp8enc', 'deadline=1', 'cpu-used=4', 'target-bitrate=4000000',
            '!', 'webmmux', '!', 'filesink', f'location={file}']
