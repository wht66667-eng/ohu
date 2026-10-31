from pathlib import Path
from PIL import Image
p=Path('design-system/fox-campus/runtime-assets')
for f in p.glob('*.png'):
    im=Image.open(f)
    im.thumbnail((720,720))
    im.save(f.with_suffix('.webp'),quality=88,method=6)
    print(f.stem, f.with_suffix('.webp').stat().st_size)
    f.replace(Path('design-system/fox-campus/source')/f.name)
