import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { ChaoxingSyncPanel } from '../../components/ChaoxingSyncPanel'
import { ChaoxingCoursesPanel } from '../../components/ChaoxingCoursesPanel'
import { ChaoxingTodoPanel } from '../../components/ChaoxingTodoPanel'
import { CHAOXING_OFFICIAL_URL, openChaoxing } from '../../lib/chaoxing'
import s from './chaoxing-bridge.module.css'

export function ChaoxingBridgePage() {
  const [opening, setOpening] = useState(false)
  const [status, setStatus] = useState('')
  const [tab, setTab] = useState<'courses' | 'todo'>('courses')

  async function openLearningApp() {
    if (opening) return
    setOpening(true)
    try {
      const destination = await openChaoxing()
      setStatus(destination === 'app' ? '已打开手机学习通。完成后回到哦狐，继续登记课程调整或作业提醒。' : '已打开学习通官方页面；如果手机未安装学习通，可从官方页面获取。')
    } catch {
      setStatus('暂时无法打开学习通，请稍后重试。')
    } finally {
      setOpening(false)
    }
  }

  return <div className={s.page}>
    <PageHeader title="学习通助手" />
    <main className={s.content}>
      <section className={s.hero}>
        <span className={s.eyebrow}>课程 · 作业 · 提醒</span>
        <h2>先去学习通看看，<br />再把重要安排带回哦狐。</h2>
        <p>在手机学习通查看课程和老师通知。遇到停课、补课或调课，复制老师通知回到哦狐核对后记录；作业通知也能整理成待办。</p>
        <button type="button" className={s.openButton} onClick={() => void openLearningApp()} disabled={opening}>
          {opening ? '正在打开…' : '打开手机学习通'} <span aria-hidden="true">↗</span>
        </button>
        <a href={CHAOXING_OFFICIAL_URL} target="_blank" rel="noopener noreferrer">学习通官方网页</a>
        {status ? <p className={s.status} role="status">{status}</p> : null}
      </section>

      <nav style={{ display: 'flex', gap: 6, padding: '4px 0 10px' }}>
        {([['courses', '课程'], ['todo', '待办']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} style={{ flex: 'none', padding: '8px 16px', borderRadius: 12, border: 0, background: tab === value ? '#fff' : 'transparent', fontWeight: tab === value ? 600 : 400 }}>{label}</button>)}
      </nav>
      {tab === 'courses' ? <ChaoxingCoursesPanel /> : <ChaoxingTodoPanel />}
      <ChaoxingSyncPanel />
      <section className={s.steps} aria-label="把学习通内容带回哦狐">
        <h3>回到哦狐后，继续记录</h3>
        <Link className={s.step} to="/schedule">
          <span className={s.stepNumber}>01</span>
          <span className={s.stepCopy}><b>记录指定日期的课程调整</b><small>复制老师的停课、补课或调课通知，打开课表里的“AI 一句话改课表”；核对预览后应用到指定日期。</small></span>
          <span className={s.arrow} aria-hidden="true">›</span>
        </Link>
        <Link className={s.step} to="/todo">
          <span className={s.stepNumber}>02</span>
          <span className={s.stepCopy}><b>记录作业和课程提醒</b><small>在待办页选择“导入学习通作业 / 老师通知”，粘贴通知，逐项确认标题、时间和链接后保存。</small></span>
          <span className={s.arrow} aria-hidden="true">›</span>
        </Link>
      </section>

      <aside className={s.privacy}>
        <b>课程数据说明</b>
        <p>只读同步需你主动登录并同意本次查询；课程与作业保存在本机当前账号，不代表云端同步。学习通课程列表与教务课表分别保存；上课时间仍以教务课表为准。“AI 一句话改课表”处理确认过的指定日期调整。作业转待办时需逐项核对，提醒沿用现有设置。</p>
      </aside>
    </main>
  </div>
}
