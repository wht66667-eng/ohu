import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../lib/auth'
import { requestAgnes } from '../../lib/agnes-ai'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../../lib/qbank'
import { BUILT_IN_PLUGIN_MODULES } from '../../plugins/registry'
import { PLUGIN_PREFERENCES_EVENT, pluginPreferencesKey, readPluginPreferences, writePluginPreferences } from '../../plugins/plugin-manifest'
import styles from './plugin-feature-page.module.css'

export function PluginFeaturePage() {
  const { pluginId = '' } = useParams()
  const plugin = BUILT_IN_PLUGIN_MODULES.find(item => item.manifest.id === pluginId)
  const auth = useAuth()
  const revision = useSyncExternalStore(subscribeQbank, () => captureQbankSession().revision, () => 0)
  const uid = auth.isSigned ? auth.user?.uid || null : null
  if (!plugin) return <div className={styles.page}><PageHeader title="插件功能" /><section className={styles.card}><h2>没有找到这个插件</h2><Link to="/services">返回服务</Link></section></div>
  if ((captureQbankSession().uid || null) !== uid) return null
  return <AccountPluginPage key={`${pluginId}:${uid || 'guest'}:${revision}`} plugin={plugin} uid={uid} />
}

function AccountPluginPage({ plugin, uid }: { plugin: typeof BUILT_IN_PLUGIN_MODULES[number]; uid: string | null }) {
  const navigate = useNavigate()
  const session = captureQbankSession()
  const [enabled, setEnabled] = useState(() => readPluginPreferences(uid).enabled.includes(plugin.manifest.id))
  useEffect(() => {
    const reload = () => setEnabled(readPluginPreferences(uid).enabled.includes(plugin.manifest.id))
    const storage = (event: StorageEvent) => { if (!event.key || event.key === pluginPreferencesKey(uid)) reload() }
    const changed = (event: Event) => { if (((event as CustomEvent<string | null>).detail || null) === uid) reload() }
    window.addEventListener('storage', storage)
    window.addEventListener(PLUGIN_PREFERENCES_EVENT, changed)
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(PLUGIN_PREFERENCES_EVENT, changed) }
  }, [plugin.manifest.id, uid])

  function toggle() {
    if (!isQbankSessionCurrent(session)) return
    const current = readPluginPreferences(uid)
    const next = current.enabled.includes(plugin.manifest.id)
      ? current.enabled.filter(id => id !== plugin.manifest.id)
      : [...current.enabled, plugin.manifest.id]
    if (writePluginPreferences(uid, { ...current, enabled: next })) setEnabled(next.includes(plugin.manifest.id))
  }

  return <div className={styles.page}>
    <PageHeader title={plugin.manifest.name} right={<Link className={styles.marketLink} to="/plugins">插件管理</Link>} onBack={() => navigate('/services')} />
    <main className={styles.content}>
      <section className={styles.intro}><span>{plugin.manifest.category}</span><p>{plugin.manifest.summary}</p></section>
      {enabled ? <>
        <PluginAiCompanion title={plugin.manifest.name} uid={uid} />
        <section className={styles.feature}><plugin.Controls enabled onToggle={toggle} /></section>
      </> : <section className={styles.card}><h2>这个插件当前已停用</h2><p>启用后就能在此使用；你也可以回到服务页管理插件。</p><button type="button" onClick={toggle}>启用插件</button><Link to="/services">返回服务</Link></section>}
    </main>
  </div>
}

function PluginAiCompanion({ title, uid }: { title: string; uid: string | null }) {
  const [input, setInput] = useState('')
  const [answer, setAnswer] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentInput, setSentInput] = useState('')
  async function ask() {
    const question = input.trim()
    if (!question || busy) return
    if (!uid) { setError('登录哦狐账号后即可使用 AI 问答。'); return }
    if (!consent) { setError('请先确认发送说明。'); return }
    const prompt = `请围绕哦狐「${title}」功能回答用户关于相关专业知识、玩法和自我反思的问题。保持简明、友好、准确；娱乐内容不作现实预测。\n用户问题：${question}`
    setBusy(true); setError(''); setAnswer('')
    try { const result = await requestAgnes('chat', prompt); setAnswer(result); setSentInput(question) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 暂时无法回应，请稍后重试。') }
    finally { setBusy(false) }
  }
  return <section className={styles.aiCard} aria-labelledby="plugin-ai-title">
    <div className={styles.aiHeading}><span>OHU AI · 先聊聊</span><h2 id="plugin-ai-title">想先了解这个功能吗？</h2><p>可以先问相关知识，也可以跳过，直接使用下面的功能。</p></div>
    <label className={styles.questionLabel} htmlFor="plugin-ai-question">你的问题</label>
    <textarea id="plugin-ai-question" value={input} maxLength={3000} onChange={event => { setInput(event.target.value); setConsent(false); setError('') }} placeholder={`例如：${title}适合怎么使用？`} rows={3} />
    <p className={styles.disclosure}>提交后，当前问题会发送给哦狐 AI 服务及模型服务商用于本次回答。请勿输入密码、学号、联系方式等个人信息。</p>
    <label className={styles.consent}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我已阅读并同意发送当前问题</span></label>
    <button type="button" disabled={busy || !input.trim() || !consent} onClick={() => void ask()}>{busy ? 'AI 正在回复…' : '和 AI 聊聊'}</button>
    {error ? <p className={styles.error} role="alert">{error}{!uid ? <> <Link to="/profile">前往登录</Link></> : null}</p> : null}
    {answer && sentInput === input.trim() ? <div className={styles.answer} aria-live="polite"><b>哦狐 AI</b><p>{answer}</p></div> : answer ? <p className={styles.disclosure} role="status">问题已修改；当前回答对应先前的问题，请重新提问。</p> : null}
  </section>
}
