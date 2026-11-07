import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { loadLocalIdentity } from '../lib/local-identity'

const GROUPS = [
  { title: '学业数据', items: [
    ['/schedule', '课表'],
    ['/grades/courses', '课程成绩'],
    ['/grades/public', '公选进度'],
    ['/study/quality', '素质拓展'],
    ['/study/pu', 'PU 成绩'],
    ['/sports/results', '体测成绩'],
    ['/study', '考试与学业中心'],
  ] },
  { title: '学习工具', items: [
    ['/study/oneclick', '一键获取'],
    ['/study/chaoxing', '学习通'],
    ['/calendar', '校历'],
    ['/todo', '待办'],
  ] },
  { title: '我的', items: [
    ['/profile', '我的'],
    ['/settings', '设置'],
    ['/services', '校园服务'],
  ] },
] as const

export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const identity = loadLocalIdentity()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.35)', animation: 'ohu-fade .18s ease-out' }}>
    <style>{'@keyframes ohu-fade{from{opacity:0}to{opacity:1}}@keyframes ohu-slide{from{transform:translateX(-100%)}to{transform:translateX(0)}}'}</style>
    <aside role="dialog" aria-label="主菜单" onClick={(event) => event.stopPropagation()} style={{ width: '78%', maxWidth: 310, height: '100%', overflowY: 'auto', background: 'var(--card,#fff)', padding: '22px 16px 90px', borderTopRightRadius: 22, borderBottomRightRadius: 22, animation: 'ohu-slide .22s cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <small style={{ opacity: 0.6 }}>哦狐 · 学生端</small>
          <h2 style={{ margin: '2px 0 0', fontSize: 20 }}>{identity ? `学号 ${identity.studentId}` : auth.isSigned ? '本机身份' : '游客浏览'}</h2>
        </div>
        <button type="button" aria-label="关闭菜单" onClick={onClose} style={{ border: 0, background: 'transparent', fontSize: 22 }}>×</button>
      </div>
      {!auth.isSigned ? <button type="button" onClick={() => { onClose(); auth.openLogin('登录后使用完整功能') }} style={{ width: '100%', marginTop: 12, padding: 10, borderRadius: 12, border: 0, background: 'var(--green,#1f8f5f)', color: '#fff' }}>用学号登录</button> : null}
      {GROUPS.map((group) => <section key={group.title} style={{ marginTop: 18 }}>
        <small style={{ opacity: 0.55 }}>{group.title}</small>
        <div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
          {group.items.map(([to, label]) => <Link key={to} to={to} onClick={() => { onClose(); navigate(to) }} style={{ padding: '10px 8px', borderRadius: 10, textDecoration: 'none', color: 'var(--text,#222)' }}>{label}<span style={{ float: 'right', opacity: 0.35 }}>›</span></Link>)}
        </div>
      </section>)}
    </aside>
  </div>
}
