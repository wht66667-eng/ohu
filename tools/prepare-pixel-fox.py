"""Prepare generated pixel fox sprites and a contact sheet from the saved prompt manifest."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'docs' / 'pixel-fox-assets.json'


def main():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    assets = manifest['assets']
    sheet = Image.new('RGB', (800, ((len(assets) + 4) // 5) * 180), '#f3fbe8')
    draw = ImageDraw.Draw(sheet)
    for index, asset in enumerate(assets):
        path = ROOT / asset['file']
        source = Path(asset['source'])
        # Originals remain untouched. A checkout without originals can reuse saved sprites.
        image = Image.open(source if source.exists() else path).convert('RGBA')
        assert image.getchannel('A').getextrema() == (0, 255), f"Missing transparency: {asset['key']}"
        assert image.getbbox(), f"Empty sprite: {asset['key']}"
        image = image.resize((512, 512), Image.Resampling.NEAREST)
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, 'PNG', optimize=True)
        x, y = (index % 5) * 160, (index // 5) * 180
        thumb = image.resize((144, 144), Image.Resampling.NEAREST)
        sheet.paste(thumb, (x + 8, y + 4), thumb)
        draw.text((x + 8, y + 153), asset['key'], fill='#365f43')
    sheet.save(ROOT / 'docs' / 'pixel-fox-preview.png', 'PNG')
    print(f"Prepared {len(assets)} transparent sprites at 512 x 512; originals retained.")


if __name__ == '__main__':
    main()
