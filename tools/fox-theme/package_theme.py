from pathlib import Path
import json,hashlib,base64
ROOT=Path(__file__).resolve().parents[2]
folder=ROOT/'design-system/fox-campus/runtime-assets'
files=sorted(f for f in folder.glob('*.webp') if f.name!='mascot.webp')
assets={f.name:base64.b64encode(f.read_bytes()).decode() for f in files}
hashes={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
(ROOT/'src/lib/fox-pack-manifest.ts').write_text('export const FOX_PACK_HASHES: Record<string,string> = '+json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
target=ROOT/'public/theme-packs/ohfox-theme-v1.ohfox';target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps({'format':'ohfox-ui-pack','version':1,'assets':assets},separators=(',',':')),encoding='utf-8')
print('Theme package bytes:',target.stat().st_size)
