import { readLearningSnapshot } from '../lib/learning-sync'

export function ChaoxingTodoPanel() {
  const snapshot = readLearningSnapshot()
  const homework = snapshot?.homework ?? []
  if (!homework.length) {
    return <section style={{ padding: 16, borderRadius: 16, background: 'var(--card,#fff)' }}>
      <b>还没有待办</b>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, opacity: 0.7 }}>用下方「学习通账号密码」同步一次，会读取课程作业；也可以在学习通 App 的「待办」页查看。</p>
    </section>
  }
  return <section style={{ padding: 16, borderRadius: 16, background: 'var(--card,#fff)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><b>学习通待办</b><small>{homework.length} 条</small></div>
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {homework.map((item) => <li key={item.key} style={{ borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: 8 }}>
        <b style={{ fontSize: 13 }}>{item.title}</b>
        <small style={{ display: 'block', opacity: 0.65 }}>{item.status}{item.dueAt ? ` · 截止 ${item.dueAt.slice(0, 16).replace('T', ' ')}` : item.deadlineText ? ` · ${item.deadlineText}` : ''}</small>
      </li>)}
    </ul>
  </section>
}
