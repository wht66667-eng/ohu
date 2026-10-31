// Explicit loopback-only sandbox. No env files, CloudBase SDK, credentials, or production writes.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createMapQaDb, runMapQaQuery } from './map-qa-db.mjs'
const root=path.resolve(import.meta.dirname,'..'), fixture=path.join(root,'tools/map-qa-fixtures.tsx')
const qa=await createMapQaDb()
const photos = new Map(); let photoId = 0
const replacements=new Set(['cb','auth','social-actor','market','reports','campus-map-location'].map(n=>path.join(root,'src/lib',n).replaceAll('\\','/')))
const server=await createServer({configFile:false,root,envDir:false,envPrefix:'MAP_QA_UNUSED_',server:{host:'127.0.0.1',port:43128,strictPort:true},plugins:[{
  name:'isolated-map-qa',enforce:'pre',
  resolveId(source,importer){if(!importer||!source.startsWith('.'))return;const resolved=path.resolve(path.dirname(importer.split('?')[0]),source).replaceAll('\\','/').replace(/\.(tsx?|jsx?)$/,'');if(replacements.has(resolved))return fixture},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if(req.url==='/__qa/photo'&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024){res.statusCode=413;res.end();return};chunks.push(chunk)};const id=String(++photoId);photos.set(id,{body:Buffer.concat(chunks),type:req.headers['content-type']});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:'http://127.0.0.1:43128/__qa/photo/'+id}));return}
    if(req.url?.startsWith('/__qa/photo/')){const image=photos.get(req.url.split('/').pop());if(!image){res.statusCode=404;res.end();return};res.setHeader('Content-Type',image.type);res.end(image.body);return}
    if(req.url==='/__qa/db'&&req.method==='POST') {try{let body='';for await(const part of req){body+=part;if(body.length>32000)throw Error('too large')};const {uid,q}=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await runMapQaQuery(qa,uid,q)))}catch(e){res.statusCode=400;res.end(JSON.stringify({error:{message:e.message}}))};return}
    if(req.url==='/'||req.url==='/campus-map'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tools/map-qa-preview.tsx"></script></body></html>'));return}
    next()
  })},
},react()]})
await server.listen(); console.log('Map QA: http://127.0.0.1:43128 — virtual students/admin; database lives in memory')
