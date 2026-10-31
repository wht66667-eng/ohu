"""Build Android launcher resources from supplied V1 PNGs; never alters source art.

This deterministic packaging step only scales the entire transparent source onto
an opaque platform plate. Existing component/alias identities remain unchanged.
"""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'public' / 'brand' / 'ohu-v1' / 'stickers'
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
PREVIEW = ROOT / 'public' / 'launcher-icon-previews'
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
PLATE = (255, 245, 226, 255)
# Keys are legacy install identities, not public day labels. Thresholds are
# 1/3/7/30 consecutive days and 1/2/3/7/15/30 missed days.
MOODS = {
    'default': '01_login_day_01.png',
    'streak_1': '01_login_day_01.png',
    'streak_3': '02_login_day_03.png',
    'streak_7': '03_login_day_07.png',
    'streak_14': '04_login_day_30.png',
    'away_2': '05_miss_day_01.png',
    'away_5': '06_miss_day_02.png',
    'away_8': '07_miss_day_03.png',
    'away_12': '08_miss_day_07.png',
    'away_15': '09_miss_day_15.png',
    'away_20': '09_miss_day_15.png',
    'away_25': '09_miss_day_15.png',
    'away_30': '10_miss_day_30.png',
}


def compose(source, size):
    # Keep every source pixel, including ears/sprout, within a generous inset.
    # No alpha trimming, retouching, background removal or cover cropping.
    image = Image.open(source).convert('RGBA')
    available = round(size * 0.82)
    ratio = min(available / image.width, available / image.height)
    image = image.resize((max(1, round(image.width * ratio)),
                          max(1, round(image.height * ratio))), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), PLATE)
    canvas.alpha_composite(image, ((size-image.width)//2, (size-image.height)//2))
    return canvas.convert('RGB')


def main():
    missing = [file for file in set(MOODS.values()) if not (ART / file).is_file()]
    if missing:
        raise SystemExit('Missing provided V1 art: ' + ', '.join(missing))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    for state, file in MOODS.items():
        name = 'ic_mood_default' if state == 'default' else 'ic_' + state
        for density, size in SIZES.items():
            target = RES / ('mipmap-' + density)
            target.mkdir(parents=True, exist_ok=True)
            image = compose(ART / file, size)
            image.save(target / (name + '.png'), optimize=True)
            if state == 'default':
                image.save(target / 'ic_launcher.png', optimize=True)
                image.save(target / 'ic_launcher_round.png', optimize=True)
            if density == 'xxxhdpi':
                image.save(PREVIEW / (state + '.png'), optimize=True)
    (PREVIEW / 'v1-mapping.json').write_text(json.dumps({
        'source': 'brand/ohu-v1/stickers',
        'note': 'Legacy alias IDs are compatibility identifiers, not day labels.',
        'opaque_background': '#fff5e2', 'source_canvas_fraction': 0.82,
        'states': MOODS,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Generated 13 V1 launcher states, 5 Android densities and matching previews. No iOS project created.')


if __name__ == '__main__':
    main()
