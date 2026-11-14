/** NON-PRODUCTION browser review entry; never imported by src/main.tsx. */
import './ui-review-network-guard'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from '../src/pages/HomePage'
import { ScheduleHome } from '../src/pages/schedule/ScheduleHome'
import { ChatRoomPage } from '../src/pages/ChatRoomPage'
import { ChatListPage } from '../src/pages/ChatListPage'
import { MessagesPage } from '../src/pages/MessagesPage'
import { MessageUpdatesPage } from '../src/pages/MessageUpdatesPage'
import { ContactsPage } from '../src/pages/ContactsPage'
import { AddFriendPage } from '../src/pages/AddFriendPage'
import { FriendRequestsPage } from '../src/pages/FriendRequestsPage'
import { NotifyPage } from '../src/pages/NotifyPage'
import { TabBar } from '../src/components/TabBar'
import { PublishSheet } from '../src/components/PublishSheet'
import { ToastProvider } from '../src/context/ToastContext'
import { Toaster } from '../src/lib/toast'
import { applyTheme, getStoredTheme } from '../src/lib/theme'
import { restoreUiVariant } from '../src/lib/ui-variant'
import { getPreviewDelay, seedSchedule, selectPreviewIdentity, setPreviewDelay, useAuth } from './ui-review-fixtures'
import { appendPreviewMessages, MESSAGE_PREVIEW_MODES, setMessagePreviewMode, useMessagePreviewMode, type MessagePreviewMode } from './ui-review-message-fixtures'
import { HOME_PREVIEW_SCENARIOS, selectHomePreviewScenario, useHomePreviewScenario, type HomePreviewScenario } from './ui-review-home-fixtures'
import { REMINDER_PREVIEW_MODES, setReminderPreviewMode, useReminderPreviewMode, type ReminderPreviewMode } from './ui-review-reminder-fixtures'
import { ReminderSettingsPreview } from './ui-review-reminder-page'
import { SocialGatePreview } from './ui-review-social-page'
import '../src/index.css'
import '../src/skins.css'
import './ui-review-preview.css'

function Review() {
  const auth = useAuth(), location = useLocation()
  const scenario = useHomePreviewScenario()
  const reminderMode = useReminderPreviewMode()
  const messageScenario = useMessagePreviewMode()
  const [publishOpen, setPublishOpen] = useState(false)
  const [slow, setSlow] = useState(getPreviewDelay() > 1000)
  const [notice, setNotice] = useState('全部使用合成数据；没有在线查询、发送或系统通知。')
  const chat = location.pathname.startsWith('/chats/')
  const reminders = location.pathname === '/settings'
  const messages = ['/messages', '/chats', '/contacts', '/notify'].some(path => location.pathname === path || location.pathname.startsWith(`${path}/`))
  function chooseIdentity(owner: string) {
    selectPreviewIdentity(owner)
    selectHomePreviewScenario(owner ? scenario.mode === 'guest' ? 'signed' : scenario.mode : 'guest')
    setSlow(getPreviewDelay() > 1000)
  }
  return <div className="ui-review-workspace">
    <header className="ui-review-label"><strong>真实组件 / 本地样例，不是在线验收</strong><span>独立 43127 端口 · 请勿输入真实教务账号或私人信息</span></header>
    <nav className="ui-review-tabs" aria-label="验收页面"><NavLink to="/" end>首页</NavLink><NavLink to="/schedule">课表</NavLink><NavLink to="/messages">消息／好友</NavLink><NavLink to="/chats/7">私信</NavLink><NavLink to="/settings?section=reminders">提醒设置</NavLink><NavLink to="/social-gate">社工端门</NavLink></nav>
    <details className="ui-review-controls"><summary>本地样例控制 · {auth.user?.name || '已退出'}</summary>
      <label className="ui-review-scenario">首页合成状态<select aria-label="首页合成状态" value={scenario.mode} onChange={(event) => { selectHomePreviewScenario(event.target.value as HomePreviewScenario); setSlow(getPreviewDelay() > 1000); setNotice('已切换首页合成状态；全部内容来自本地样例。') }}>{HOME_PREVIEW_SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {reminders ? <label className="ui-review-scenario">提醒合成反馈<select aria-label="提醒合成反馈" value={reminderMode} onChange={(event) => { setReminderPreviewMode(event.target.value as ReminderPreviewMode); setNotice('已切换提醒反馈样例；系统通知、后台桥接和权限请求均已阻止。') }}>{REMINDER_PREVIEW_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
      {messages ? <label className="ui-review-scenario">消息合成状态<select aria-label="消息合成状态" value={messageScenario.mode} onChange={(event) => { setMessagePreviewMode(event.target.value as MessagePreviewMode); setNotice('已切换消息本地样例；首页其他场景不变。未向真实用户发送消息、请求或通知。') }}>{MESSAGE_PREVIEW_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
      <div><button onClick={() => chooseIdentity('local:ui-review-a')}>样例甲</button><button onClick={() => chooseIdentity('local:ui-review-b')}>样例乙</button><button onClick={() => chooseIdentity('')}>退出样例</button><button onClick={() => { chooseIdentity('local:ui-review-b'); chooseIdentity('local:ui-review-a') }}>甲→乙→甲</button></div>
      <div><button aria-pressed={slow} onClick={() => { setPreviewDelay(slow ? 180 : 4000); setSlow(!slow) }}>{slow ? '恢复快速响应' : '模拟 4 秒延迟'}</button>{chat ? <><button onClick={() => { appendPreviewMessages(); setNotice('已加入 1 条合成消息；真实组件会在下一次 5 秒轮询显示。') }}>插入 1 条样例消息</button><button onClick={() => { appendPreviewMessages(40); setNotice('已加入 40 条合成消息；观察分页补齐与新消息提示。') }}>插入 40 条样例消息</button></> : <button onClick={() => { seedSchedule(); setNotice('已重置当前样例账号的合成课表缓存。') }}>重置样例课表</button>}</div>
    </details>
    <p className="ui-review-status" role="status">{notice}</p>
    <div className="ui-review-shell" data-home-preview-phone data-reminder-preview-phone={reminders || undefined} data-message-preview-phone={messages || undefined}>
    <div className={`ui-review-body${chat ? ' ui-review-chat' : ''}`} data-app-body data-app-page data-home-preview-main data-reminder-preview-main={reminders || undefined} data-message-preview-main={messages || undefined}>
      <Routes><Route path="/" element={<HomePage key={scenario.revision} />} /><Route path="/schedule" element={<ScheduleHome />} /><Route path="/chats" element={<ChatListPage key={messageScenario.revision} />} /><Route path="/chats/:id" element={<ChatRoomPage key={messageScenario.revision} />} /><Route path="/settings" element={<ReminderSettingsPreview />} /><Route path="/social-gate" element={<SocialGatePreview />} /><Route path="/messages" element={new URLSearchParams(location.search).get('view') === 'updates' ? <MessageUpdatesPage key={messageScenario.revision} /> : <MessagesPage key={messageScenario.revision} />} /><Route path="/contacts" element={<ContactsPage key={messageScenario.revision} />} /><Route path="/contacts/add" element={<AddFriendPage key={messageScenario.revision} />} /><Route path="/contacts/requests" element={<FriendRequestsPage key={messageScenario.revision} />} /><Route path="/notify" element={<NotifyPage key={messageScenario.revision} />} /><Route path="*" element={<PreviewDestination />} /></Routes>
    </div>
    <div className="ui-review-tabbar"><TabBar onPlus={() => setPublishOpen(true)} /></div>
    </div>
    {publishOpen ? <PublishSheet onClose={() => setPublishOpen(false)} /> : null}
    <Toaster />
  </div>
}
function PreviewDestination() {
  const location = useLocation()
  return <div className="ui-review-placeholder"><h1>已到达入口</h1><p>目标：{location.pathname}{location.search}</p><p>本轮预览包含真实首页、课表、私信和发布选择面板。其他业务页面暂未装载，所有在线操作均已阻止。</p><Link to="/">返回首页</Link></div>
}
applyTheme(getStoredTheme())
void restoreUiVariant()
// Seed only after module initialization; schedule-cache and auth fixtures depend on each other.
seedSchedule()
createRoot(document.getElementById('root')!).render(<HashRouter><ToastProvider><Review /></ToastProvider></HashRouter>)
