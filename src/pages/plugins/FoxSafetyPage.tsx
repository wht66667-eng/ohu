import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { useAuth } from '../../lib/auth'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../../lib/qbank'
import { PLUGIN_PREFERENCES_EVENT, pluginPreferencesKey, readPluginPreferences } from '../../plugins/plugin-manifest'
import { FOX_SAFETY_PLUGIN_ID, MAX_SAFETY_IMPORT_BYTES, readSafetyImport, removeSafetyImport, safetyImportKey, saveSafetyImport, searchSafetyQuestions, type SafetyQuestion, type SafetySource } from '../../plugins/fox-safety'
import { loadBundledSafetyBank } from '../../plugins/fox-safety-bank-loader'
import styles from './fox-safety.module.css'

export function FoxSafetyPage() {
  const auth = useAuth()
  const revision = useSyncExternalStore(subscribeQbank, () => captureQbankSession().revision, () => 0)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  if (captureQbankSession().uid !== uid) return <p role="status">正在切换插件账号…</p>
  return <AccountSafetyPage key={`${uid}:${revision}`} uid={uid} />
}

function AccountSafetyPage({ uid }: { uid: string }) {
  const [enabled, setEnabled] = useState(() => readPluginPreferences(uid).enabled.includes(FOX_SAFETY_PLUGIN_ID))
  useEffect(() => {
    const load = () => setEnabled(readPluginPreferences(uid).enabled.includes(FOX_SAFETY_PLUGIN_ID))
    const storage = (event: StorageEvent) => { if (!event.key || event.key === pluginPreferencesKey(uid)) load() }
    const changed = (event: Event) => { if (((event as CustomEvent).detail || '') === uid) load() }
    window.addEventListener('storage', storage)
    window.addEventListener(PLUGIN_PREFERENCES_EVENT, changed)
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(PLUGIN_PREFERENCES_EVENT, changed) }
  }, [uid])
  return <div className={styles.page}>
    <PageHeader title="fox 安全知识" right={<Link to="/plugins">插件商城</Link>} />
    {enabled ? <SafetyLibrary uid={uid} /> : <section className={styles.panel}>
      <h2>先启用，再打开题库</h2><p>这是创作者 wft 接入的非官方学习插件。到插件商城启用后，即可使用离线检索；停用会关闭当前工具，不会移除已导入的题库。</p>
      <Link className={styles.primary} to="/plugins">前往插件商城</Link>
    </section>}
  </div>
}

function SafetyLibrary({ uid }: { uid: string }) {
  const session = useRef(captureQbankSession())
  const mounted = useRef(true)
  const [bank, setBank] = useState<SafetyQuestion[]>([])
  const [imported, setImported] = useState(() => readSafetyImport(uid))
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [source, setSource] = useState<SafetySource>('all')
  const [page, setPage] = useState(0)
  const [importBusy, setImportBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const resultsTop = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    mounted.current = true
    const onStorage = (event: StorageEvent) => {
      if ((event.key === null || event.key === safetyImportKey(uid)) && isQbankSessionCurrent(session.current)) {
        setImported(readSafetyImport(uid)); setPage(0)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => { mounted.current = false; window.removeEventListener('storage', onStorage) }
  }, [uid])
  useEffect(() => {
    let live = true
    setBusy(true); setLoadError('')
    void loadBundledSafetyBank().then(rows => { if (live) setBank(rows) }).catch(error => { if (live) setLoadError(error.message) }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [attempt])
  const rows = useMemo(() => [...bank, ...imported.questions], [bank, imported.questions])
  const results = useMemo(() => searchSafetyQuestions(rows, deferredQuery, source, page), [rows, deferredQuery, source, page])

  async function importFile(file: File | undefined) {
    if (!file || importBusy) return
    setImportError(''); setMessage('')
    if (!/\.json$/i.test(file.name) || file.size > MAX_SAFETY_IMPORT_BYTES) { setImportError('请选择不超过 1 MB 的 .json 题库文件。'); return }
    setImportBusy(true)
    try {
      const text = await file.text()
      if (!mounted.current || !isQbankSessionCurrent(session.current)) return
      const questions = saveSafetyImport(uid, text)
      setImported({ questions, error: '' }); setPage(0)
      setMessage(`已将 ${questions.length} 条来源记录保存在本机当前账号下；未上传。`)
    } catch (error) {
      if (mounted.current && isQbankSessionCurrent(session.current)) setImportError(error instanceof Error ? error.message : '导入失败，请检查题库格式。')
    } finally { if (mounted.current && isQbankSessionCurrent(session.current)) setImportBusy(false) }
  }

  function removeImported() {
    if (!isQbankSessionCurrent(session.current)) return
    try {
      removeSafetyImport(uid); setImported({ questions: [], error: '' }); setPage(0); setImportError(''); setMessage('已移除本机导入题库，内置题库保持不变。')
    } catch (error) { setImportError(error instanceof Error ? error.message : '移除失败，请重试。') }
    setConfirmRemove(false)
  }

  function turnPage(next: number) {
    setPage(next)
    resultsTop.current?.scrollIntoView({ block: 'start' })
  }

  return <>
    <section className={styles.intro}>
      <span className={styles.badge}>非官方插件 · wft · 本机检索</span>
      <h2>安全知识，随手查一查。</h2>
      <p>检索题目与选项，展开查看参考答案。内置题库随哦狐安装包提供，不需要登录学校平台。</p>
      <div className={styles.counts}><span>内置 <b>{busy && !bank.length ? '加载中' : bank.length}</b></span><span>本机导入 <b>{imported.questions.length}</b></span></div>
    </section>
    <section className={styles.panel} aria-label="检索安全知识">
      <label className={styles.label} htmlFor="fox-safety-query">题目关键词</label>
      <div className={styles.search}><input id="fox-safety-query" type="search" maxLength={160} value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="例如：消防、宿舍、涉密计算机" autoComplete="off" />{query ? <button type="button" onClick={() => { setQuery(''); setPage(0) }}>清空</button> : null}</div>
      <div className={styles.filters} role="group" aria-label="题库来源">
        {([['all', '全部来源'], ['github', '内置题库'], ['imported', '本机导入']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={source === value} onClick={() => { setSource(value); setPage(0) }}>{label}</button>)}
      </div>
    </section>
    <details className={styles.panel}>
      <summary>导入自己的 JSON 题库</summary>
      <div className={styles.importBody}>
        <p>最多 1 MB、2000 条，导入会替换本账号上一次导入的记录。只读取题目与答案文本，不执行文件中的代码。</p>
        <code>{'{"schemaVersion":1,"questions":[{"title":"题目","answer":"A"}]}'}</code>
        <label className={styles.label}>选择题库文件<input type="file" accept=".json,application/json" disabled={importBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file) }} /></label>
        {imported.questions.length || imported.error ? <button className={styles.secondary} type="button" disabled={importBusy} onClick={() => setConfirmRemove(true)}>移除本机导入题库</button> : null}
      </div>
    </details>
    {importBusy ? <p className={styles.status} role="status">正在读取题库文件…</p> : null}
    {message ? <p className={styles.status} role="status">{message}</p> : null}
    {importError || imported.error ? <p className={styles.error} role="alert">{importError || imported.error}</p> : null}
    {loadError ? <div className={styles.error} role="alert"><p>{loadError}</p><button className={styles.secondary} type="button" onClick={() => setAttempt(value => value + 1)}>重试加载内置题库</button></div> : null}
    <section className={styles.results} aria-labelledby="fox-safety-results">
      <h2 id="fox-safety-results" ref={resultsTop}>检索结果</h2>
      <p className={styles.status} role="status">{busy ? '正在加载内置题库…' : query !== deferredQuery ? '正在筛选…' : `匹配 ${results.total} 条来源记录${results.total ? ` · 第 ${results.page + 1} / ${results.lastPage + 1} 页` : ''}`}</p>
      {results.items.map(row => <article className={styles.question} key={`${row.source}:${row.id}`}>
        <span className={styles.source}>{row.source === 'github' ? 'Scwizard · 内置题库' : '本机导入 · 用户资料'}</span>
        <h3>{row.title}</h3>
        <details><summary>查看{row.options.length ? '选项与' : ''}参考答案</summary>
          {row.options.length ? <ol className={styles.options}>{row.options.map(option => <li key={option.key}><b>{option.key}</b><span>{option.text}</span></li>)}</ol> : <p className={styles.note}>此来源只提供题目与答案文本，未提供选项内容；请核对原题选项顺序。</p>}
          <p className={styles.answer}><strong>{row.answerKind === 'option_ids' ? '平台选项 ID' : '参考答案'}：</strong>{row.answer}</p>
        </details>
      </article>)}
      {!busy && !results.total ? <div className={styles.panel}><h3>没有匹配记录</h3><p>{source === 'imported' && !imported.questions.length ? '先导入自己的 JSON 题库，或切换到内置题库。' : '试试更短的关键词，或切换到全部来源。'}</p></div> : null}
      {results.lastPage > 0 ? <nav className={styles.pagination} aria-label="题库分页"><button type="button" disabled={!results.page} onClick={() => turnPage(results.page - 1)}>上一页</button><span>{results.page + 1} / {results.lastPage + 1}</span><button type="button" disabled={results.page === results.lastPage} onClick={() => turnPage(results.page + 1)}>下一页</button></nav> : null}
    </section>
    <details className={styles.panel}><summary>来源、数据与服务状态</summary><div className={styles.importBody}>
      <p>内置数据来自 Scwizard 的 Apache-2.0 项目，固定版本 4b797158。这里统计来源记录，未把两套题库的重复题目宣传为独立题数；参考答案请结合安全知识和原题核对。</p>
      <a href="/plugin-licenses/fox-safety-Apache-2.0.txt" target="_blank" rel="noreferrer">查看随包 Apache-2.0 许可</a>
      <p>导入数据仅保存在本机当前账号下，不会上传，也不访问哦狐个人题库。停用插件保留导入资料，移除需手动确认。</p>
      <p>原 fox 项目预填的服务器地址尚未部署验收。此插件离线运行，不调用学校登录、任务执行、自动填答、交卷或页面注入接口。</p>
    </div></details>
    {confirmRemove ? <ConfirmSheet title="移除导入题库？" desc="仅移除本机当前账号导入的题库；内置题库不受影响。之后可以重新导入原 JSON 文件。" confirmText="移除导入题库" danger onClose={() => setConfirmRemove(false)} onConfirm={removeImported} /> : null}
  </>
}
