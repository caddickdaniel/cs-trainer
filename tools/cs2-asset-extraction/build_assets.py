#!/usr/bin/env python3
"""Builds the CS2 icon set used by Demo Review from YOUR local CS2 install.

Valve's artwork is never committed: run `npm run cs2:assets` on each machine.
Steps:
  1. Find CS2 (Steam library folders, libraryfolders.vdf) and pak01_dir.vpk.
  2. Extract the Panorama images with ValveResourceFormat's Source2Viewer-CLI
     (read-only; the game install is never modified) into work/raw/.
  3. Copy each catalogued icon to client/public/assets/cs2/<category>/ as SVG
     (vector, what the app uses), and export PNGs:
       - general icons: 256x256, transparent, centred, aspect kept, padded;
       - kill feed weapons/indicators: natural width at a fixed 64px height,
         transparent padding trimmed;
       - white and black monochrome variants (alpha preserved).
  4. Write manifest.json (source archive and path, sizes, variants, status,
     weapon id mappings), validate every file and draw a contact sheet.

Requirements: work/venv with cairosvg and pillow (see README "Phase 9").
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RAW = HERE / 'work' / 'raw' / 'panorama' / 'images'
OUT = ROOT / 'client' / 'public' / 'assets' / 'cs2'
VRF = HERE / 'bin' / 'vrf' / 'Source2Viewer-CLI'
VPK_NAME = 'pak01_dir.vpk'
FILTER = 'panorama/images/icons/equipment/,panorama/images/hud/deathnotice/,panorama/images/hud/teamcounter/,panorama/images/hud/radar/,panorama/images/icons/ui/'

try:
    import cairosvg
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('Run with tools/cs2-asset-extraction/work/venv/bin/python (pip install cairosvg pillow).')

# ---- Catalogue -----------------------------------------------------------------
# (id, display name, source path under panorama/images, demo/game weapon ids)
EQ = 'icons/equipment/'
WEAPONS = {
    'pistols': [('glock', 'Glock-18'), ('usp_silencer', 'USP-S'), ('hkp2000', 'P2000'), ('p250', 'P250'), ('fiveseven', 'Five-SeveN'),
                ('tec9', 'Tec-9'), ('cz75a', 'CZ75-Auto'), ('deagle', 'Desert Eagle'), ('revolver', 'R8 Revolver'), ('elite', 'Dual Berettas')],
    'smgs': [('mac10', 'MAC-10'), ('mp9', 'MP9'), ('mp7', 'MP7'), ('mp5sd', 'MP5-SD'), ('ump45', 'UMP-45'), ('p90', 'P90'), ('bizon', 'PP-Bizon')],
    'rifles': [('ak47', 'AK-47'), ('m4a1', 'M4A4'), ('m4a1_silencer', 'M4A1-S'), ('famas', 'FAMAS'), ('galilar', 'Galil AR'), ('aug', 'AUG'), ('sg556', 'SG 553')],
    'snipers': [('awp', 'AWP'), ('ssg08', 'SSG 08'), ('scar20', 'SCAR-20'), ('g3sg1', 'G3SG1')],
    'heavy': [('nova', 'Nova'), ('xm1014', 'XM1014'), ('mag7', 'MAG-7'), ('sawedoff', 'Sawed-Off'), ('m249', 'M249'), ('negev', 'Negev')],
    'knives': [('knife', 'Knife (CT default)'), ('knife_t', 'Knife (T default)'), ('bayonet', 'Bayonet'), ('knife_bowie', 'Bowie Knife'),
               ('knife_butterfly', 'Butterfly Knife'), ('knife_canis', 'Survival Knife'), ('knife_cord', 'Paracord Knife'), ('knife_css', 'Classic Knife'),
               ('knife_falchion', 'Falchion Knife'), ('knife_flip', 'Flip Knife'), ('knife_gut', 'Gut Knife'), ('knife_gypsy_jackknife', 'Navaja Knife'),
               ('knife_karambit', 'Karambit'), ('knife_kukri', 'Kukri Knife'), ('knife_m9_bayonet', 'M9 Bayonet'), ('knife_outdoor', 'Nomad Knife'),
               ('knife_push', 'Shadow Daggers'), ('knife_skeleton', 'Skeleton Knife'), ('knife_stiletto', 'Stiletto Knife'),
               ('knife_survival_bowie', 'Bowie Knife (Survival)'), ('knife_tactical', 'Huntsman Knife'), ('knife_twinblade', 'Talon Knife (Twinblade)'),
               ('knife_ursus', 'Ursus Knife'), ('knife_widowmaker', 'Talon Knife')],
}
UTILITY = [('smokegrenade', 'Smoke Grenade'), ('flashbang', 'Flashbang'), ('hegrenade', 'HE Grenade'), ('molotov', 'Molotov'),
           ('incgrenade', 'Incendiary Grenade'), ('decoy', 'Decoy Grenade'), ('inferno', 'Fire (kill feed)'), ('firebomb', 'Fire bomb')]
ARMOUR = [('kevlar', 'Kevlar Vest', EQ + 'kevlar'), ('assaultsuit', 'Kevlar + Helmet', EQ + 'assaultsuit'), ('helmet', 'Helmet', EQ + 'helmet'),
          ('armor', 'Armour', EQ + 'armor'), ('armor_helmet', 'Armour + Helmet', EQ + 'armor_helmet'), ('heavy_armor', 'Heavy Armour', EQ + 'heavy_armor'),
          ('hud_armor', 'Armour (team counter)', 'hud/teamcounter/armor'), ('hud_armor_helmet', 'Armour + Helmet (team counter)', 'hud/teamcounter/armor_helmet'),
          ('ui_armor', 'Armour (UI)', 'icons/ui/armor'), ('ui_helmet', 'Helmet (UI)', 'icons/ui/helmet')]
EQUIPMENT = [('defuser', 'Defuse Kit', EQ + 'defuser'), ('defuser_white', 'Defuse Kit (white, team counter)', 'icons/ui/defuser_white'),
             ('taser', 'Zeus x27', EQ + 'taser'), ('c4', 'C4 Explosive', EQ + 'c4'), ('planted_c4', 'Planted C4', EQ + 'planted_c4'),
             ('healthshot', 'Medi-Shot', EQ + 'healthshot'), ('bomb_c4', 'C4 (UI)', 'icons/ui/bomb_c4'), ('bomb_icon', 'Bomb (UI)', 'icons/ui/bomb_icon'),
             ('bomb', 'Bomb (UI)', 'icons/ui/bomb')]
KILLFEED_INDICATORS = [('headshot', 'Headshot', 'hud/deathnotice/icon_headshot'), ('penetrate', 'Wallbang', 'hud/deathnotice/penetrate'),
                       ('noscope', 'No-scope', 'hud/deathnotice/noscope'), ('smoke_kill', 'Through smoke', 'hud/deathnotice/smoke_kill'),
                       ('blind_kill', 'Attacker blind', 'hud/deathnotice/blind_kill'), ('suicide', 'Suicide', 'hud/deathnotice/icon_suicide'),
                       ('inairkill', 'Attacker in the air', 'hud/deathnotice/inairkill'), ('domination', 'Domination', 'hud/deathnotice/domination'),
                       ('revenge', 'Revenge', 'hud/deathnotice/revenge'), ('flashbang_assist', 'Flash assist', EQ + 'flashbang_assist'),
                       ('smokegrenade_impact', 'Smoke impact', 'hud/deathnotice/smokegrenade_impact')]
KILLFEED_SPECIAL = [('world', 'World', EQ + 'world'), ('worldent', 'World entity', EQ + 'worldent'), ('trigger_hurt', 'Trigger hurt', EQ + 'trigger_hurt'),
                    ('prop_exploding_barrel', 'Exploding barrel', EQ + 'prop_exploding_barrel'), ('stomp_damage', 'Stomp', EQ + 'stomp_damage'),
                    ('planted_c4', 'C4 explosion', EQ + 'planted_c4'), ('inferno', 'Fire', EQ + 'inferno'), ('melee', 'Melee', EQ + 'melee')]
HUD = {
    'scoreboard': [('elimination', 'Eliminated (skull)', 'icons/ui/elimination'), ('elimination_headshot', 'Eliminated (headshot)', 'icons/ui/elimination_headshot'),
                   ('kill', 'Kill', 'icons/ui/kill'), ('kill_headshot', 'Headshot kill', 'icons/ui/kill_headshot'), ('stat_assists', 'Assists', 'icons/ui/stat_assists'),
                   ('stat_headshots', 'Headshots', 'icons/ui/stat_headshots')],
    'spectator': [('killtype_default', 'Kill type: default', 'hud/teamcounter/killtype_default'), ('killtype_headshot', 'Kill type: headshot', 'hud/teamcounter/killtype_headshot'),
                  ('killtype_blast', 'Kill type: blast', 'hud/teamcounter/killtype_blast'), ('killtype_burn', 'Kill type: burn', 'hud/teamcounter/killtype_burn'),
                  ('killtype_slash', 'Kill type: knife', 'hud/teamcounter/killtype_slash'), ('killtype_shock', 'Kill type: Zeus', 'hud/teamcounter/killtype_shock'),
                  ('damage_report_frame', 'Damage report frame', 'hud/teamcounter/damage-report-frame'), ('botavatar', 'Bot avatar', 'hud/teamcounter/teamcounter_botavatar'),
                  ('dominated', 'Dominated', 'hud/teamcounter/teamcounter_dominated'), ('skull', 'Skull (team counter)', 'hud/teamcounter/teamcounter_skull_png'),
                  ('skull_teammate', 'Skull (teammate)', 'hud/teamcounter/teamcounter_skull-teammate_png'), ('alive_skull', 'Alive counter skull', 'hud/teamcounter/teamcounter_aliveskull_png'),
                  ('alive_bg_ct', 'Alive counter CT', 'hud/teamcounter/teamcounter_alivebgct_png'), ('alive_bg_t', 'Alive counter T', 'hud/teamcounter/teamcounter_alivebgt_png'),
                  ('timer', 'Timer', 'icons/ui/timer'), ('clock', 'Clock', 'icons/ui/clock'), ('health', 'Health', 'icons/ui/health'), ('player', 'Player', 'icons/ui/player'),
                  ('ct_logo', 'CT logo', 'icons/ui/ct_logo_1c'), ('radar_ct_logo', 'CT logo (radar)', 'hud/radar/radarctlogo'), ('radar_t_logo', 'T logo (radar)', 'hud/radar/radartlogo')],
    'player': [('flashed', 'Player flashed (radar)', 'hud/radar/mapoverview/icon-flashed_png'), ('low_health', 'Player low health (radar)', 'hud/radar/mapoverview/icon-player-low-health_png'),
               ('muzzle_flash', 'Player firing (radar)', 'hud/radar/mapoverview/icon-muzzle-flash_png'), ('death', 'Player death (radar)', 'hud/radar/mapoverview/icon-death'),
               ('death_black', 'Player death, black (radar)', 'hud/radar/mapoverview/icon-death_black'), ('direction', 'Direction indicator', 'hud/radar/icon_direction_indicator'),
               ('on_map', 'Player on map', 'hud/radar/icon-on-map_png'), ('enemy_on_map', 'Enemy on map', 'hud/radar/icon-enemy-on-map_png'),
               ('ct_ghost', 'CT ghost', 'hud/radar/icon-ct-ghost_png'), ('t_ghost', 'T ghost', 'hud/radar/icon-t-ghost_png'),
               ('speaking', 'Speaking', 'hud/radar/icon-speaking-on-map_png'), ('player_indicator', 'Player indicator', 'hud/radar/icon-player-indicator_png')],
    'objectives': [('bombzone_a', 'Bombsite A', 'icons/ui/map_bombzone_a'), ('bombzone_b', 'Bombsite B', 'icons/ui/map_bombzone_b'),
                   ('radar_bombzone_a', 'Bombsite A (radar)', 'hud/radar/icon-bomb-zone-a_png'), ('radar_bombzone_b', 'Bombsite B (radar)', 'hud/radar/icon-bomb-zone-b_png'),
                   ('bomb_planted', 'Bomb planted (team counter)', 'hud/teamcounter/teamcounter_bomb-planted'), ('bomb_planted_lines', 'Bomb planted pulse lines', 'hud/teamcounter/teamcounter_bomb-planted-lines'),
                   ('bomb_defused', 'Bomb defused (team counter)', 'hud/teamcounter/teamcounter_bomb-planted-defused'), ('bomb_above', 'Bomb above (radar)', 'icons/ui/map_bomb_above'),
                   ('bomb_below', 'Bomb below (radar)', 'icons/ui/map_bomb_below'), ('c4_small', 'C4 (radar)', 'hud/radar/c4_sml_png'),
                   ('defuse', 'Defusing (radar)', 'icons/ui/map_defuse'), ('defuser_dropped', 'Defuse kit dropped (radar)', 'icons/ui/map_defused_dropped'),
                   ('radar_defuse', 'Defuse (radar)', 'hud/radar/icon-radar-defuse_png'), ('radar_defuser', 'Defuse kit (radar)', 'hud/radar/icons-defuser_png'),
                   ('dropped_defuse_kit', 'Dropped defuse kit (radar)', 'hud/radar/icon-defuse-dropped_png')],
}
RADAR_UTILITY = [('radar_smoke', 'Smoke (radar)', 'hud/radar/mapoverview/png_smoke_png'), ('radar_flash', 'Flash (radar)', 'hud/radar/mapoverview/png_flash_png'),
                 ('radar_he', 'HE (radar)', 'hud/radar/mapoverview/png_he_png'), ('radar_molotov', 'Molotov (radar)', 'hud/radar/mapoverview/png_molotov_png'),
                 ('radar_decoy', 'Decoy (radar)', 'hud/radar/mapoverview/png_decoy_png'), ('map_smoke', 'Active smoke (radar)', 'icons/ui/map_smoke')]
# Items asked for that the game files don't provide as images (checked by name search).
NOT_IN_GAME = {
    'player planting / defusing progress': 'Drawn by the HUD (progress bars), no image resource',
    'player burning, scoped, footsteps': 'No image resources found under panorama/images',
    'team kill indicator': 'The kill feed shows team kills with names only (no icon resource)',
    'knife / grenade / molotov kill indicators': 'Only as team-counter kill types (killtype_slash, killtype_blast, killtype_burn)',
    'separate kill feed weapon silhouettes': 'The kill feed uses icons/equipment/<weapon> (same files as the inventory icons)',
}

GENERAL = 256
GENERAL_PAD = 16
KILLFEED_HEIGHT = 64


def find_vpk():
    env = os.environ.get('CS2_DIR')
    candidates = [Path(env)] if env else []
    libraries = [Path.home() / '.local/share/Steam', Path.home() / '.steam/steam', Path.home() / '.steam/root']
    for lib in list(libraries):
        vdf = lib / 'steamapps/libraryfolders.vdf'
        if vdf.exists():
            libraries += [Path(p) for p in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(errors='ignore'))]
    for lib in libraries:
        candidates.append(lib / 'steamapps/common/Counter-Strike Global Offensive/game/csgo')
    for c in candidates:
        if (c / VPK_NAME).exists():
            return c / VPK_NAME
    sys.exit('CS2 not found. Checked:\n  ' + '\n  '.join(str(c) for c in candidates) + '\nSet CS2_DIR to the game/csgo folder.')


def extract(vpk):
    if not VRF.exists():
        sys.exit(f'{VRF} is missing: see README "Phase 9" for the ValveResourceFormat download.')
    print(f'Extracting from {vpk} (read-only)…')
    subprocess.run([str(VRF), '-i', str(vpk), '-o', str(HERE / 'work' / 'raw'), '-d', '--threads', '8', '-f', FILTER],
                   check=True, stdout=subprocess.DEVNULL)


def source_file(rel):
    for ext in ('.svg', '.png'):
        p = RAW / (rel + ext)
        if p.exists():
            return p
    return None


def render(src, height=None, size=None):
    """Rasterises an SVG (or loads a PNG) as RGBA at a generous resolution."""
    if src.suffix == '.svg':
        import io
        data = cairosvg.svg2png(url=str(src), output_height=height or 512)
        return Image.open(io.BytesIO(data)).convert('RGBA')
    return Image.open(src).convert('RGBA')


def fit_square(img):
    box = img.getbbox()
    if box:
        img = img.crop(box)
    inner = GENERAL - 2 * GENERAL_PAD
    scale = min(inner / img.width, inner / img.height)
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (GENERAL, GENERAL), (0, 0, 0, 0))
    canvas.paste(img, ((GENERAL - img.width) // 2, (GENERAL - img.height) // 2), img)
    return canvas


def fit_height(img):
    box = img.getbbox()
    if box:
        img = img.crop(box)
    w = max(1, round(img.width * KILLFEED_HEIGHT / img.height))
    return img.resize((w, KILLFEED_HEIGHT), Image.LANCZOS)


def mono(img, rgb):
    alpha = img.getchannel('A')
    out = Image.new('RGBA', img.size, rgb + (0,))
    out.putalpha(alpha)
    return out


def main():
    vpk = find_vpk()
    if '--extract' in sys.argv or not RAW.exists():
        extract(vpk)
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest = {'generated_from': str(vpk), 'source_archive': VPK_NAME, 'tool': 'ValveResourceFormat Source2Viewer-CLI 20.1',
                'note': 'Valve artwork extracted from the local CS2 install. Not for redistribution.', 'assets': {}, 'weapons': {}, 'missing': [], 'not_in_game': NOT_IN_GAME}

    def add(asset_id, name, category, rel, killfeed=False):
        src = source_file(rel)
        key = f'{category}/{asset_id}'
        if not src:
            manifest['missing'].append({'id': key, 'display_name': name, 'resource': f'panorama/images/{rel}.vsvg|_png.vtex'})
            return None
        folder = OUT / category
        folder.mkdir(parents=True, exist_ok=True)
        entry = {'display_name': name, 'category': category, 'resource': f'panorama/images/{rel}' + ('.vsvg' if src.suffix == '.svg' else '.vtex'),
                 'archive': VPK_NAME, 'status': 'extracted', 'variants': ['original', 'white', 'black']}
        if src.suffix == '.svg':
            shutil.copyfile(src, folder / f'{asset_id}.svg')
            entry['svg'] = f'/assets/cs2/{category}/{asset_id}.svg'
            m = re.search(r'viewBox="([\d.\s-]+)"', src.read_text(errors='ignore'))
            if m:
                vb = [float(x) for x in m.group(1).split()]
                entry['original_size'] = [vb[2], vb[3]]
        img = render(src)
        if not img.getchannel('A').getbbox():
            # Present but blank in the game (e.g. world/trigger_hurt: no weapon icon is shown for those deaths).
            (folder / f'{asset_id}.svg').unlink(missing_ok=True)
            manifest.setdefault('empty_in_game', []).append({'id': key, 'resource': entry['resource']})
            return None
        if src.suffix != '.svg':
            entry['original_size'] = list(img.size)
        out = fit_height(img) if killfeed else fit_square(img)
        out.save(folder / f'{asset_id}.png')
        entry['png'] = f'/assets/cs2/{category}/{asset_id}.png'
        entry['exported_size'] = list(out.size)
        for variant, rgb in (('white', (255, 255, 255)), ('black', (0, 0, 0))):
            vdir = OUT / 'variants' / variant / category
            vdir.mkdir(parents=True, exist_ok=True)
            mono(out, rgb).save(vdir / f'{asset_id}.png')
            entry[f'png_{variant}'] = f'/assets/cs2/variants/{variant}/{category}/{asset_id}.png'
        manifest['assets'][key] = entry
        return entry

    for group, items in WEAPONS.items():
        for wid, name in items:
            inv = add(wid, name, f'weapons/{group}', EQ + wid)
            kf = add(wid, name, 'killfeed/weapons', EQ + wid, killfeed=True)
            if inv:
                manifest['weapons'][f'weapon_{wid}'] = {'displayName': name, 'group': group, 'inventoryIcon': inv['png'], 'inventorySvg': inv.get('svg'),
                                                        'killfeedIcon': kf['png'] if kf else None, 'killfeedSvg': kf.get('svg') if kf else None}
    for uid, name in UTILITY:
        add(uid, name, 'utility', EQ + uid)
        add(uid, name, 'killfeed/weapons', EQ + uid, killfeed=True)
    for uid, name, rel in RADAR_UTILITY:
        add(uid, name, 'utility', rel)
    for aid, name, rel in ARMOUR:
        add(aid, name, 'equipment', rel)
    for eid, name, rel in EQUIPMENT:
        add(eid, name, 'equipment', rel)
        if eid in ('taser', 'c4', 'planted_c4'):
            add(eid, name, 'killfeed/weapons', rel, killfeed=True)
    for iid, name, rel in KILLFEED_INDICATORS:
        add(iid, name, 'killfeed/indicators', rel, killfeed=True)
    for sid, name, rel in KILLFEED_SPECIAL:
        add(sid, name, 'killfeed/special', rel, killfeed=True)
    for group, items in HUD.items():
        for hid, name, rel in items:
            add(hid, name, f'hud/{group}', rel)
    bomb = [('c4', 'C4', EQ + 'c4'), ('planted_c4', 'Planted C4', EQ + 'planted_c4'), ('bomb_planted', 'Bomb planted', 'hud/teamcounter/teamcounter_bomb-planted'),
            ('bomb_defused', 'Bomb defused', 'hud/teamcounter/teamcounter_bomb-planted-defused'), ('killtype_blast', 'Explosion', 'hud/teamcounter/killtype_blast')]
    for bid, name, rel in bomb:
        add(bid, name, 'bomb', rel)

    # ---- Validation ----
    problems = []
    seen = {}
    for key, e in manifest['assets'].items():
        for field in ('png', 'png_white', 'png_black', 'svg'):
            if field in e and not (OUT.parent.parent / e[field].lstrip('/')).exists():
                problems.append(f'{key}: {field} missing on disk')
        im = Image.open(OUT.parent.parent / e['png'].lstrip('/'))
        if im.mode != 'RGBA':
            problems.append(f'{key}: not RGBA')
        box = im.getchannel('A').getbbox()
        if not box:
            problems.append(f'{key}: fully transparent')
        elif e['category'].startswith('killfeed'):
            if im.height != KILLFEED_HEIGHT:
                problems.append(f'{key}: kill feed height {im.height}')
        elif box[0] < GENERAL_PAD - 1 and box[2] > GENERAL - GENERAL_PAD + 1:
            problems.append(f'{key}: touches the edges (cropped?)')
        digest = (e['category'].split('/')[0], im.tobytes())
        if digest in seen and not e['category'].startswith('killfeed'):
            manifest.setdefault('identical_images', []).append([seen[digest], key])
        seen.setdefault(digest, key)
    manifest['validation'] = {'assets': len(manifest['assets']), 'problems': problems}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))

    # ---- Contact sheet ----
    groups = {}
    for key, e in manifest['assets'].items():
        groups.setdefault(e['category'], []).append((key, e))
    cell, cols, label_h = 96, 12, 18
    rows = sum(1 + (len(v) + cols - 1) // cols for v in groups.values())
    sheet = Image.new('RGB', (cols * cell, rows * (cell + label_h) + 10), (36, 36, 36))
    draw = ImageDraw.Draw(sheet)
    y = 0
    for cat, items in groups.items():
        draw.text((6, y + 4), f'{cat} ({len(items)})', fill=(255, 200, 80))
        y += 24
        for i, (key, e) in enumerate(items):
            x = (i % cols) * cell
            if i and i % cols == 0:
                y += cell + label_h
            im = Image.open(OUT.parent.parent / e['png'].lstrip('/'))
            im.thumbnail((cell - 12, cell - 20), Image.LANCZOS)
            sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - 20 - im.height) // 2 + 4), im)
            draw.text((x + 3, y + cell - 14), key.split('/')[-1][:15], fill=(200, 200, 200))
        y += cell + label_h
    sheet = sheet.crop((0, 0, sheet.width, y + 4))
    sheet.save(OUT / 'contact-sheet.png')

    total = len(manifest['assets'])
    print(f'{total} assets ({total * 2} monochrome variants), {len(manifest["weapons"])} weapons mapped, '
          f'{len(manifest["missing"])} missing, {len(problems)} validation problems')
    for p in problems:
        print('  !', p)
    for m in manifest['missing']:
        print('  missing:', m['id'], m['resource'])


if __name__ == '__main__':
    main()
