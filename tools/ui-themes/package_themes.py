from pathlib import Path
import base64,hashlib,json
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'design-system/fox-campus/runtime-assets'
meta={
 'cute':{'uiVersion':3,'name':'软萌几何','radius':20,'radiusLarge':24,'green':'#16735b','fox':'#ff9a3d','blush':'#ffb3a0','belly':'#fff0dc','paw':'#ffe4c7','darkFox':'#ffa657','motion':'jelly','live3d':False},
 'minimal':{'uiVersion':4,'name':'极简大气','radius':16,'radiusLarge':20,'green':'#16735b','page':'#fafafa','card':'#ffffff','line':'#e5ece8','darkPage':'#101512','darkCard':'#18201b','darkLine':'#2a3830','motion':'soft','live3d':False}
}
silhouette=b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#16735b" d="M8 8 25 18h14L56 8l-3 33-21 15L11 41Z"/><path fill="#fff" d="m13 35 13 4 6 10 6-10 13-4-8 13-11 7-11-7Z"/><path fill="#fff" d="M21 28h5v3h-5zm17 0h5v3h-5z"/><path fill="#16735b" d="m28 38 4 5 4-5Z"/></svg>'
hashes={}
for id,info in meta.items():
 raw={'theme.json':json.dumps(info,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()}
 if id=='cute':raw.update({p.name:p.read_bytes() for p in source.glob('*.webp') if p.name!='mascot.webp'})
 else:raw['fox.svg']=silhouette
 hashes[id]={n:hashlib.sha256(data).hexdigest() for n,data in sorted(raw.items())}
 package={'format':'ohfox-ui-pack','version':1,'id':id,'assets':{n:base64.b64encode(data).decode() for n,data in sorted(raw.items())}}
 file=ROOT/'public/theme-packs'/('ohfox-cute-v3.ohfox' if id=='cute' else 'ohfox-minimal-v4.ohfox')
 file.write_text(json.dumps(package,separators=(',',':')),encoding='utf-8')
 print(file.name,file.stat().st_size,'bytes')
(ROOT/'src/lib/ui-pack-manifest.ts').write_text('export const NEW_UI_PACK_HASHES = '+json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
