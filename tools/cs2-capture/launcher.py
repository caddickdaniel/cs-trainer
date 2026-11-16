"""CS2 process lifecycle for capture sessions.

- Launches CS2 through the Steam Linux Runtime (this avoids the "Processing
  Vulkan shaders" dialog Steam can show) with -condebug -console, in a
  window of a chosen size (1280x720 by default; captures are saved at
  1280x720) using a capture video profile written to cs2_video.txt for
  the life of the instance. The player's own file is backed up first and put
  back once the instance has exited (CS2 rewrites it on exit).
- Tracks which CS2 process belongs to the session (a marker environment
  variable, falling back to "the cs2 process that appeared after launch"), so
  closing never touches an unrelated CS2.
- Brings the window into focus without the user: _NET_ACTIVE_WINDOW first,
  then a virtual absolute pointer (uinput) moved to the window centre, which
  only clicks once XWayland reports the pointer inside the CS2 window (so CS2
  is the topmost surface under it).
"""
import glob
import json
import os
import re
import shutil
import signal
import subprocess
import time

import xconsole as xc

STEAM = os.path.expanduser('~/.local/share/Steam')
MARKER = 'CSTRAINER_CAPTURE_SESSION'


def game_root():
    libs = [STEAM, os.path.expanduser('~/.steam/steam')]
    for lib in list(libs):
        try:
            text = open(os.path.join(lib, 'steamapps/libraryfolders.vdf'), encoding='utf-8').read()
            libs += re.findall(r'"path"\s+"([^"]+)"', text)
        except OSError:
            pass
    for lib in libs:
        root = os.path.join(lib, 'steamapps/common/Counter-Strike Global Offensive/game')
        if os.path.exists(os.path.join(root, 'cs2.sh')):
            return root, lib
    return None, None


def runtime(lib):
    for cand in (os.path.join(lib, 'steamapps/common/SteamLinuxRuntime_sniper/run'), os.path.join(STEAM, 'steamapps/common/SteamLinuxRuntime_sniper/run')):
        if os.path.exists(cand):
            return cand
    return None


def video_cfgs():
    return glob.glob(os.path.join(STEAM, 'userdata/*/730/local/cfg/cs2_video.txt'))


def cs2_pids():
    out = subprocess.run(['pgrep', '-x', 'cs2'], capture_output=True, text=True).stdout.split()
    return [int(p) for p in out]


def cmdline(pid):
    try:
        return open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\0', b' ').decode('utf-8', 'replace')
    except OSError:
        return ''


def has_marker(pid, token):
    try:
        return f'{MARKER}={token}'.encode() in open(f'/proc/{pid}/environ', 'rb').read()
    except OSError:
        return False


# Capture video profile: what changes from the player's file. Lower settings
# that don't affect what a frame shows (shadow detail, ambient occlusion,
# particles kept at medium so smokes/molotovs look as in game, textures at
# medium so lineup landmarks stay readable). Benchmarked in the README.
PROFILES = {
    'capture': {
        'setting.fullscreen': '0', 'setting.coop_fullscreen': '0', 'setting.nowindowborder': '0',
        'setting.high_dpi': '0', 'setting.mat_vsync': '0',
        'setting.msaa_samples': '2', 'setting.r_csgo_cmaa_enable': '0',
        'setting.videocfg_shadow_quality': '0', 'setting.videocfg_dynamic_shadows': '0',
        'setting.videocfg_ao_detail': '0', 'setting.videocfg_parallax_detail': '0',
        'setting.videocfg_texture_detail': '1', 'setting.videocfg_particle_detail': '1',
        'setting.r_texturefilteringquality': '1', 'setting.shaderquality': '0', 'setting.videocfg_fsr_detail': '0',
    },
    # Same window, the player's own quality settings (for comparison runs).
    'native': {
        'setting.fullscreen': '0', 'setting.coop_fullscreen': '0', 'setting.nowindowborder': '0', 'setting.high_dpi': '0',
    },
}


def apply_profile(text, values):
    for k, v in values.items():
        line = f'\t"{k}"\t\t"{v}"'
        if re.search(rf'^\s*"{re.escape(k)}"\s+"[^"]*"\s*$', text, re.M):
            text = re.sub(rf'^\s*"{re.escape(k)}"\s+"[^"]*"\s*$', line, text, flags=re.M)
        else:
            text = text.rstrip().rstrip('}').rstrip() + '\n' + line + '\n}\n'
    return text


class Instance:
    """One CS2 process for a capture session (launched by us, or reused)."""

    def __init__(self, state_dir):
        self.state_dir = state_dir
        self.pid = None
        self.launched = False
        self.backups = []
        self.log_existed = None
        self.root = None

    @property
    def log_path(self):
        return os.path.join(self.root, 'csgo', 'console.log') if self.root else None

    def find_running(self):
        """An already running CS2 and whether it logs to console.log (needed
        to confirm each step)."""
        pids = cs2_pids()
        if not pids:
            return None, None
        usable = [p for p in pids if '-condebug' in cmdline(p) and '-console' in cmdline(p)]
        return (usable[0], True) if usable else (pids[0], False)

    def launch(self, profile='capture', size=(1280, 720), timeout=180):
        root, lib = game_root()
        if not root:
            raise RuntimeError('cs2_missing|CS2 is not installed in a Steam library on this machine.')
        rt = runtime(lib)
        if not rt:
            raise RuntimeError('cs2_missing|The Steam Linux Runtime (sniper) is missing; start CS2 from Steam once.')
        self.root = root
        before = set(cs2_pids())
        if before:
            raise RuntimeError('cs2_running|CS2 is already running without -condebug, so capture can\'t confirm its steps. Close CS2 and try again.')
        # Back up and switch the video profile for this instance (None: the
        # player's own settings, used when opening a demo to watch).
        os.makedirs(self.state_dir, exist_ok=True)
        for cfg in (video_cfgs() if profile else []):
            bak = os.path.join(self.state_dir, 'video-backup-' + cfg.split('/userdata/')[1].split('/')[0] + '.txt')
            shutil.copy2(cfg, bak)
            self.backups.append((cfg, bak))
            text = open(cfg, encoding='utf-8').read()
            with open(cfg, 'w', encoding='utf-8') as f:
                values = dict(PROFILES.get(profile, PROFILES['capture']))
                values.update({'setting.defaultres': str(size[0]), 'setting.defaultresheight': str(size[1])})
                f.write(apply_profile(text, values))
        self._save_state()
        self.log_existed = os.path.exists(self.log_path)
        token = f'{os.getpid()}-{int(time.time())}'
        env = dict(os.environ, SteamAppId='730', SteamGameId='730', **{MARKER: token})
        out = open(os.path.join(self.state_dir, 'cs2-launch.log'), 'w')
        args = ['-steam', '-novid', '-condebug', '-console'] + (['-windowed', '-w', str(size[0]), '-h', str(size[1])] if profile else [])
        subprocess.Popen([rt, '--', './cs2.sh', *args],
                         cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True)
        self.launched = True
        end = time.time() + timeout
        while time.time() < end:
            new = [p for p in cs2_pids() if p not in before]
            mine = [p for p in new if has_marker(p, token)] or new
            if mine:
                self.pid = mine[0]
                self._save_state()
                return self.pid
            time.sleep(0.5)
        raise RuntimeError('cs2_start|CS2 did not start within 3 minutes.')

    def use_running(self, pid):
        self.pid = pid
        self.root, _ = game_root()
        self.launched = False

    def alive(self):
        return self.pid is not None and os.path.exists(f'/proc/{self.pid}')

    def wait_window(self, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            if not self.alive():
                raise RuntimeError('cs2_closed|CS2 exited during startup.')
            win = xc.find_cs2()
            if win:
                return win
            time.sleep(0.5)
        raise RuntimeError('cs2_start|The CS2 window did not appear.')

    def wait_menu(self, log, at, timeout=180):
        log.wait(r'CSGO_GAME_UI_STATE_MAINMENU|Source2Init OK', at, timeout, 'cs2_start', 'CS2 did not reach the main menu.')

    def close(self, send_quit=None, timeout=40):
        """Quits CS2 if this session launched it, then restores the video
        profile and removes the console log the session created."""
        if self.launched and self.alive():
            if send_quit:
                try:
                    send_quit()
                except Exception:  # noqa: BLE001 - fall back to signals
                    pass
            end = time.time() + timeout
            while self.alive() and time.time() < end:
                time.sleep(0.5)
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if not self.alive():
                    break
                try:
                    os.kill(self.pid, sig)
                except OSError:
                    pass
                time.sleep(5)
        if self.launched:
            self.restore_files()

    def restore_files(self):
        for cfg, bak in self.backups:
            try:
                shutil.copy2(bak, cfg)
                os.remove(bak)
            except OSError:
                pass
        self.backups = []
        if self.log_existed is False and self.log_path and os.path.exists(self.log_path):
            try:
                os.remove(self.log_path)
            except OSError:
                pass
        self._clear_state()

    # A crash of this tool must not leave the player's settings changed:
    # the state file lets the next session restore them.
    def _save_state(self):
        with open(os.path.join(self.state_dir, 'instance.json'), 'w') as f:
            json.dump({'pid': self.pid, 'backups': self.backups, 'log_existed': self.log_existed, 'root': self.root}, f)

    def _clear_state(self):
        try:
            os.remove(os.path.join(self.state_dir, 'instance.json'))
        except OSError:
            pass

    @staticmethod
    def recover(state_dir):
        """Restores files left by a session that died, once its CS2 has exited."""
        p = os.path.join(state_dir, 'instance.json')
        try:
            st = json.load(open(p))
        except (OSError, ValueError):
            return False
        if st.get('pid') and os.path.exists(f"/proc/{st['pid']}"):
            return False  # still running; restore after it exits
        inst = Instance(state_dir)
        inst.backups = [tuple(b) for b in st.get('backups', [])]
        inst.log_existed = st.get('log_existed')
        inst.root = st.get('root')
        inst.launched = True
        inst.restore_files()
        return True
