import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CampusMapPage } from '../src/pages/CampusMapPage'
import { AdminCampusMapPane } from '../src/pages/AdminCampusMapPane'
import { ToastProvider } from '../src/context/ToastContext'
import { Toaster } from '../src/lib/toast'
import { useAuth, selectQaIdentity } from './map-qa-fixtures'
import '../src/index.css'
function Preview() {
  const auth=useAuth()
  return <ToastProvider><div style={{padding:12,background:'#fff3c9',color:'#443509',position:'sticky',top:0,zIndex:1000}}><b>本地虚拟验收 · 不连接正式云端</b><label style={{marginLeft:12}}>测试身份 <select aria-label="测试身份" value={auth.user?.uid||''} onChange={e=>selectQaIdentity(e.target.value)}><option value="qa-student-a">测试学生甲</option><option value="qa-student-b">测试学生乙</option><option value="qa-admin">测试管理员</option><option value="">游客</option></select></label><label style={{marginLeft:12}}>模拟定位 <select aria-label="模拟定位" defaultValue={localStorage.getItem('map-qa-location')||'success'} onChange={e=>localStorage.setItem('map-qa-location',e.target.value)}><option value="success">成功（虚拟坐标）</option><option value="denied">拒绝权限</option><option value="outside">不在连云港</option></select></label></div><BrowserRouter>{auth.profile.isAdmin?<AdminCampusMapPane/>:<CampusMapPage key={auth.user?.uid||'guest'}/>}</BrowserRouter><Toaster/></ToastProvider>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
