import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const module = { exports: {} }
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/moment-photo-quality.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(source, { module, exports: module.exports, require, Uint8ClampedArray, Float64Array })
const { processPhotoPixels: process } = module.exports
const settings = (mode, strength = 75, filter = 'none') => ({ mode, strength, filter })
function image(w, h, pixel) { const data = new Uint8ClampedArray(w * h * 4); for (let y=0;y<h;y++) for (let x=0;x<w;x++) data.set(pixel(x,y), (y*w+x)*4); return data }
const variance = data => { let sum=0,square=0,n=data.length/4; for(let i=0;i<data.length;i+=4){sum+=data[i];square+=data[i]**2} return square/n-(sum/n)**2 }
test('不处理和零强度逐字节保留输入，输入自身不变', () => { const data=image(17,9,(x,y)=>[x*8,y*9,122,101]); const before=[...data]; assert.deepEqual([...process(data,17,9,settings('none'))],before); assert.deepEqual([...process(data,17,9,settings('blur',0))],before); assert.deepEqual([...data],before) })
test('三个频域操作保持常量图和alpha，覆盖非幂次尺寸与1像素边界', () => { for(const [w,h] of [[1,1],[7,19],[87,81]]) for(const mode of ['denoise','blur','sharpen']) { const data=image(w,h,()=>[41,127,209,73]), out=process(data,w,h,settings(mode)); for(let i=0;i<out.length;i++) assert.ok(Math.abs(out[i]-data[i])<=1,`${w}x${h}/${mode}/${i}`) } })
test('柔和去噪与模糊确实抑制棋盘高频，不只是改CSS预览', () => { const data=image(83,85,(x,y)=>[(x+y)%2?200:60,100,120,255]); for(const mode of ['denoise','blur']) assert.ok(variance(process(data,83,85,settings(mode)))<variance(data)*.15) })
test('锐化增强低对比边缘', () => { const data=image(41,23,x=>[128+12*Math.sin(x*.9),128,128,255]); assert.ok(variance(process(data,41,23,settings('sharpen')))>variance(data)*1.5) })
test('分块交界处的脉冲响应平移一致，没有明显接缝', () => { const a=image(161,43,(x,y)=>[x===79&&y===21?255:0,0,0,255]); const b=image(161,43,(x,y)=>[x===80&&y===21?255:0,0,0,255]); const aa=process(a,161,43,settings('blur',70)),bb=process(b,161,43,settings('blur',70)); for(let y=5;y<38;y++)for(let x=60;x<98;x++)assert.ok(Math.abs(aa[(y*161+x)*4]-bb[(y*161+x+1)*4])<=1) })
test('滤镜保留alpha，黑白三通道相等',()=>{ const data=image(3,2,()=>[190,80,30,55]); for(const filter of ['mono','warm','cool','vivid']) { const out=process(data,3,2,settings('none',0,filter)); for(let i=0;i<out.length;i+=4){assert.equal(out[i+3],55);if(filter==='mono'){assert.equal(out[i],out[i+1]);assert.equal(out[i],out[i+2])}} } })
test('非法尺寸、像素长度、模式和NaN强度在分配内存前拒绝',()=>{for(const args of [[new Uint8ClampedArray(4),0,1,settings('blur')],[new Uint8ClampedArray(4),2049,1,settings('blur')],[new Uint8ClampedArray(4),2,1,settings('blur')],[new Uint8ClampedArray(4),1,1,settings('unknown')],[new Uint8ClampedArray(4),1,1,settings('blur',NaN)]])assert.throws(()=>process(...args))})

test('Haar小波保持常量和透明度，非幂次和单像素可逆',()=>{for(const [w,h] of [[1,1],[7,19],[83,85]])for(const mode of ['wavelet-denoise','wavelet-detail']){const data=image(w,h,()=>[43,123,203,71]),out=process(data,w,h,settings(mode));for(let i=0;i<data.length;i++)assert.ok(Math.abs(out[i]-data[i])<=1,`${mode}/${i}`)}})
test('小波降噪降低高频方差，细节增强放大低对比细节',()=>{const data=image(83,85,(x,y)=>[128+((x+y)%2?12:-12),100,100,255]);assert.ok(variance(process(data,83,85,settings('wavelet-denoise')))<variance(data)*.2);assert.ok(variance(process(data,83,85,settings('wavelet-detail')))>variance(data)*2)})
test('专业调节真实改像素，拒绝越界和非数参数',()=>{const data=image(4,4,()=>[60,60,60,77]);const out=process(data,4,4,{...settings('none'),adjustments:{exposure:1}});assert.ok(out[0]>data[0]);assert.equal(out[3],77);for(const adjustments of [{gamma:0},{contrast:NaN},{exposure:99}])assert.throws(()=>process(data,4,4,{...settings('none'),adjustments}))})
test('中值滤波去除孤立亮点，Sobel边缘保留alpha',()=>{const data=image(9,9,(x,y)=>[x===4&&y===4?255:70,70,70,33]);const out=process(data,9,9,settings('median',100));assert.ok(out[(4*9+4)*4]<100);const edge=process(data,9,9,settings('edges'));for(let i=3;i<edge.length;i+=4)assert.equal(edge[i],33)})

test('校园滤镜强度独立，零强度不改原色，黑白预设满强度保留 alpha', () => {
  const pixels = image(5, 7, () => [120, 70, 35, 99])
  const base = { ...settings('none', 0), preset: 'whiteboard' }
  assert.deepEqual(process(pixels, 5, 7, { ...base, filterStrength: 0 }), pixels)
  const full = process(pixels, 5, 7, { ...base, filterStrength: 100 })
  const half = process(pixels, 5, 7, { ...base, filterStrength: 50 })
  assert.equal(full[0], full[1])
  assert.equal(full[1], full[2])
  assert.equal(full[3], 99)
  assert.ok(Math.abs(half[0] - (full[0] + pixels[0]) / 2) <= 1)
})

test('自适应小波保留常量与 alpha，并降低合成棋盘噪声', () => {
  const config = { ...settings('wavelet-denoise', 100), adaptiveWavelet: true, waveletLevels: 2, waveletThreshold: .8 }
  const constant = image(17, 9, () => [50, 100, 125, 91])
  assert.deepEqual(process(constant, 17, 9, config), constant)
  const noise = image(32, 32, (x, y) => [100 + ((x + y) % 2 ? 15 : -15), 100, 100, 91])
  assert.ok(variance(process(noise, 32, 32, config)) < variance(noise) * .2)
})
