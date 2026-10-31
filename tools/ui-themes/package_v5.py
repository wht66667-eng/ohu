"""Package actual reviewed V5 mascot and skinned model with fixed hashes."""
from pathlib import Path
import base64, hashlib, json
ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'design-system/ui-v5/runtime-assets'
meta = {'uiVersion': 5, 'name': '阿狐陪伴', 'green': '#16735b', 'fox': '#ff9a3d', 'live3d': True, 'animations': ['idle', 'wave', 'loading', 'success', 'fail']}
raw = {'theme.json': json.dumps(meta, ensure_ascii=False, sort_keys=True).encode()}
for name in ['mascot.png', 'fox.glb']:
    raw[name] = (source / name).read_bytes()
hashes = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(raw.items())}
pack = {'format': 'ohfox-ui-pack', 'version': 1, 'id': 'immersive', 'assets': {name: base64.b64encode(data).decode() for name, data in sorted(raw.items())}}
target = ROOT / 'public/theme-packs/ohfox-immersive-v5.ohfox'
target.write_text(json.dumps(pack, separators=(',', ':')), encoding='utf-8')
(ROOT / 'src/lib/immersive-pack-manifest.ts').write_text('export const IMMERSIVE_PACK_HASHES = ' + json.dumps(hashes, indent=2) + '\n', encoding='utf-8')
print(target.name, target.stat().st_size, 'bytes', hashes)
