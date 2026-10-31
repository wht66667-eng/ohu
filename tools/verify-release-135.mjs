import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root=process.cwd(), mode=process.argv[2]
if(!['before','after'].includes(mode)) throw Error('Use before or after')
const packet=JSON.parse(readFileSync('.release-out/release-packet.json','utf8'))
if(packet.version!=='1.2.135') throw Error('Release identity mismatch')
const base='https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com'
const paths=['/update.json','/ota/user/manifest.json','/ota/admin/manifest.json','/ota/manifest.json']
const report={mode,at:new Date().toISOString(),manifests:{},downloads:[]}
for(const path of paths){const res=await fetch(base+path+'?verify135='+Date.now(),{signal:AbortSignal.timeout(45000)});if(!res.ok) throw Error(`${path} HTTP ${res.status}`);const value=await res.json();report.manifests[path]=value;console.log(`${path}: ${value.version||value.latestVersion}`)}
if(mode==='before') {
  if(Object.values(report.manifests).some(m=>(m.build||m.latestBuild)>135)) throw Error('Newer release exists; do not downgrade')
} else {
  for(const value of Object.values(report.manifests)) if((value.version||value.latestVersion)!=='1.2.135'||(value.build||value.latestBuild)!==135) throw Error('Online discovery version mismatch')
  const apk=JSON.parse(readFileSync('.release-out/apk/1.2.135-135/release-both.json','utf8'))
  for(const shell of ['user','admin']) {
    const ota=report.manifests[`/ota/${shell}/manifest.json`]
    if(JSON.stringify(ota)!==JSON.stringify(packet.ota.find(i=>i.shell===shell).manifest)) throw Error(`OTA descriptor mismatch ${shell}`)
    const asset=report.manifests['/update.json'].flavors[shell].androidArm64, local=apk.artifacts.find(i=>i.shell===shell)
    if(asset.sha256!==local.sha256||asset.size!==local.bytes) throw Error('APK manifest does not match verified file')
    for(const item of [{kind:'apk',url:asset.url,hash:local.sha256,size:local.bytes},{kind:'ota',url:ota.url,hash:ota.checksum,size:ota.size}]) {
      const response=await fetch(item.url,{signal:AbortSignal.timeout(120000)})
      if(!response.ok) throw Error(`${shell} ${item.kind} HTTP ${response.status}`)
      const hash=createHash('sha256');let bytes=0;for await(const chunk of response.body){hash.update(chunk);bytes+=chunk.length}
      const digest=hash.digest('hex');if(digest!==item.hash||bytes!==item.size) throw Error(`Downloaded bytes mismatch ${shell} ${item.kind}`)
      report.downloads.push({shell,kind:item.kind,url:item.url,sha256:digest,bytes});console.log(`Verified download: ${shell} ${item.kind}, ${bytes} bytes`)
    }
  }
  const html=await (await fetch(base+'/?verify135='+Date.now(),{signal:AbortSignal.timeout(30000)})).text()
  const localHtml=readFileSync('.release-out/web-upload/index.html','utf8')
  if(html!==localHtml) throw Error('Online website entry differs from prepared entry')
  report.websiteEntryMatches=true
}
mkdirSync('.release-out',{recursive:true});writeFileSync(`.release-out/verification-135-${mode}.json`,JSON.stringify(report,null,2)+'\n')
