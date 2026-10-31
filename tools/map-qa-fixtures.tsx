// LOCAL QA ONLY. Resolved exclusively by map-qa-server.mjs; no real credentials.
import { useSyncExternalStore } from 'react'
import { selectImSession } from '../src/lib/im-session'
let uid = localStorage.getItem('map-qa-identity') || 'qa-student-a'
const listeners = new Set<() => void>()
const snapshot = () => ({isSigned:!!uid,user:uid?{uid}:null,profile:{isAdmin:uid==='qa-admin'},openLogin:()=>alert('请选择上方的测试学生账号')})
let auth = snapshot()
selectImSession(uid)
export const useAuth = () => useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn)}},()=>auth)
export function selectQaIdentity(value:string) { uid=value;localStorage.setItem('map-qa-identity',uid);selectImSession(uid);auth=snapshot();listeners.forEach(fn=>fn()) }
export const currentActor = () => uid ? {uid,name:'虚拟测试用户',avatar:''} : null
export const uploadImages = async (files:File[]) => {
  const urls:string[]=[]
  for(const file of files){const response=await fetch('/__qa/photo',{method:'POST',headers:{'Content-Type':file.type},body:file});if(!response.ok)return{urls,error:'本地模拟上传失败'};urls.push((await response.json()).url)}
  return {urls,error:null}
}
export async function getCurrentMapLocation() {
  if(localStorage.getItem('map-qa-location')==='denied')throw Error('定位权限未允许，请在手机设置中允许哦狐使用位置，或在地图上选点')
  if(localStorage.getItem('map-qa-location')==='outside')return {lng:116.4,lat:39.9,accuracy:100}
  return {lng:119.2172,lat:34.5933,accuracy:12}
}
export const submitReport = async () => ({error:'虚拟验收不提交线上举报'})
export function cbRdb() { return {from(table:string) {
  const owner=uid, q:any={table,op:'select',filters:[]}
  const chain:any={select(columns='*'){q.columns=columns;return chain},insert(data:any){q.op='insert';q.data=data;return chain},update(data:any){q.op='update';q.data=data;return chain},eq(k:string,v:any){q.filters.push([k,v]);return chain},order(k:string,options:any){q.order=k;q.asc=options?.ascending;return chain},limit(n:number){q.limit=n;return chain},then(ok:any,bad:any){return fetch('/__qa/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:owner,q})}).then(r=>r.json()).then(ok,bad)}}
  return chain
} } }
