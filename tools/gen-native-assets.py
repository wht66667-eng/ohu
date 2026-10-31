"""Generate web/native branding from the reference pixel fox. No network required."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
ART = ROOT / 'public' / 'pixel-fox'
MINT = (243, 251, 232)
INK = (54, 101, 67)
ICON_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
MOODS = {
    'mood_default': 'avatar',
    'streak_1': 'welcome', 'streak_3': 'cheer', 'streak_7': 'trophy', 'streak_14': 'jump',
    'away_2': 'waiting', 'away_5': 'encourage', 'away_8': 'puzzled', 'away_12': 'sad',
    'away_15': 'determined', 'away_20': 'lonely', 'away_25': 'calling', 'away_30': 'pleading',
}
SPLASH_SIZES = {
    'drawable/splash.png': (480, 320),
    'drawable-land-mdpi/splash.png': (480, 320),
    'drawable-land-hdpi/splash.png': (800, 480),
    'drawable-land-xhdpi/splash.png': (1280, 720),
    'drawable-land-xxhdpi/splash.png': (1600, 960),
    'drawable-land-xxxhdpi/splash.png': (1920, 1280),
    'drawable-port-mdpi/splash.png': (320, 480),
    'drawable-port-hdpi/splash.png': (480, 800),
    'drawable-port-xhdpi/splash.png': (720, 1280),
    'drawable-port-xxhdpi/splash.png': (960, 1600),
    'drawable-port-xxxhdpi/splash.png': (1280, 1920),
}
FONTS = (Path('C:/Windows/Fonts/msyhbd.ttc'), Path('C:/Windows/Fonts/msyh.ttc'),
         Path('C:/Windows/Fonts/simhei.ttf'))


def fox(pose, size):
    # Nearest-neighbor preserves the supplied stepped pixel outlines.
    return Image.open(ART / f'{pose}.png').convert('RGBA').resize((size, size), Image.Resampling.NEAREST)


def icon(size, pose='avatar', foreground=False):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0) if foreground else (*MINT, 255))
    # Adaptive icon foreground stays inside the central 66/108 dp safe area.
    sprite = fox(pose, round(size * (0.58 if foreground else 0.88)))
    canvas.alpha_composite(sprite, ((size - sprite.width) // 2, (size - sprite.height) // 2))
    return canvas


def save(path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'PNG', optimize=True)


def splash(width, height):
    short = min(width, height)
    canvas = Image.new('RGB', (width, height), MINT)
    size = round(short * 0.35)
    sprite = fox('reading', size)
    x, y = (width - size) // 2, round(height * 0.42 - size / 2)
    canvas.paste(sprite, (x, y), sprite)
    font = next((ImageFont.truetype(str(p), round(short * 0.065)) for p in FONTS if p.exists()),
                ImageFont.load_default())
    draw = ImageDraw.Draw(canvas)
    text = '阳光校园'
    bounds = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - bounds[2] + bounds[0]) / 2 - bounds[0], y + size + short * 0.045),
              text, font=font, fill=INK)
    return canvas


def main():
    # Check each required image before writing any output.
    missing = sorted(pose for pose in set(MOODS.values()) | {'reading'} if not (ART / f'{pose}.png').is_file())
    if missing:
        raise SystemExit('Missing fox poses: ' + ', '.join(missing))
    for density, size in ICON_SIZES.items():
        folder = RES / f'mipmap-{density}'
        for name, pose in MOODS.items():
            save(folder / f'ic_{name}.png', icon(size, pose))
        save(folder / 'ic_launcher.png', icon(size))
        save(folder / 'ic_launcher_round.png', icon(size))
        save(folder / 'ic_launcher_foreground.png', icon(FOREGROUND_SIZES[density], foreground=True))
    for rel, size in SPLASH_SIZES.items():
        save(RES / rel, splash(*size))
    ios = ROOT / 'ios' / 'App' / 'App' / 'Assets.xcassets'
    save(ios / 'AppIcon.appiconset' / 'AppIcon-512@2x.png', icon(1024).convert('RGB'))
    save(ios / 'Splash.imageset' / 'Splash.png', splash(1366, 1366))
    save(ROOT / 'public' / 'favicon.png', icon(64))
    print('Generated 13 mood icons at five Android densities, launcher foregrounds, 11 Android splashes, iOS icon/splash and web favicon.')


if __name__ == '__main__':
    main()
