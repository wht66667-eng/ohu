import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCompanionPreferences as validate, companionPoint, MAX_COMPANION_DATA_LENGTH } from '../src/lib/companion-preferences.ts'

test('宠物设置拒绝脚本、远程URL、SVG与超大图片数据', () => {
  for (const image of ['https://example.org/pet.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+'a'.repeat(MAX_COMPANION_DATA_LENGTH)]) assert.equal(validate({image}).image,'')
  assert.equal(validate({image:'data:image/png;base64,YQ=='}).image,'data:image/png;base64,YQ==')
  for (const raw of [null,[],7,'oops']) assert.deepEqual(validate(raw),{image:'',position:null})
})
test('损坏或越界位置回退默认，不能把宠物藏到可见区域外',()=>{
  for(const position of [{x:NaN,y:0},{x:Infinity,y:1},{x:-.1,y:.1},{x:.2,y:1.1},{x:'1',y:'0'}]) assert.equal(validate({position}).position,null)
  assert.deepEqual(validate({position:{x:0,y:1}}).position,{x:0,y:1})
})
test('常见视口与两端位置始终保留边距和底部导航空间',()=>{
  for(const [width,height] of [[320,480],[390,844],[480,860]])for(const position of [null,{x:0,y:0},{x:1,y:1},{x:.5,y:.5}]){
    const point=companionPoint(position,width,height);assert.ok(point.x>=8&&point.x+76<=width-8);assert.ok(point.y>=8&&point.y+84<=height-90)
  }
})
