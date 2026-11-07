import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { CampusIcon } from './CampusIcon'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../lib/qbank'
import {
  BUILT_IN_PLUGINS,
  PLUGIN_PREFERENCES_EVENT,
  pluginPreferencesKey,
  readPluginPreferences,
  writePluginPreferences,
  type OhuPluginManifest,
  type PluginLocalPreferences,
} from '../plugins/plugin-manifest'
import { BUILT_IN_PLUGIN_MODULES } from '../plugins/registry'
import styles from './PluginMarketplace.module.css'

const PERMISSION_LABELS: Record<OhuPluginManifest['permissions'][number], string> = {
  'schedule:open': '打开课表',
  'todo:open': '打开待办',
  'focus:open': '打开专注',
  'word-study:read': '读取本机单词计划',
  'word-study:write': '保存本机复习进度',
  'qbank:read': '读取本机题库',
  'local-bank:read': '读取本插件的本机导入题库',
  'local-bank:write': '保存或移除本插件的导入题库',
}

export function PluginMarketplace() {
  const auth = useAuth()
  const revision = useSyncExternalStore(subscribeQbank, () => captureQbankSession().revision, () => 0)
  const uid = auth.isSigned ? auth.user?.uid || null : null
  if ((captureQbankSession().uid || null) !== uid) return <p role="status">正在切换插件账号…</p>
  return <AccountPluginMarketplace key={`${uid || 'guest'}:${revision}`} uid={uid} />
}

function AccountPluginMarketplace({ uid }: { uid: string | null }) {
  const [searchParams] = useSearchParams()
  const requestedPlugin = searchParams.get('plugin')
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const toast = useToast()
  const session = useRef(captureQbankSession())
  const [preferences, setPreferences] = useState<PluginLocalPreferences>(() => readPluginPreferences(uid))
  useEffect(() => {
    const load = () => { if (isQbankSessionCurrent(session.current)) setPreferences(readPluginPreferences(uid)) }
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === pluginPreferencesKey(uid)) load() }
    const onChange = (event: Event) => { if ((event as CustomEvent<string | null>).detail === uid) load() }
    window.addEventListener('storage', onStorage)
    window.addEventListener(PLUGIN_PREFERENCES_EVENT, onChange)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(PLUGIN_PREFERENCES_EVENT, onChange) }
  }, [uid])

  useEffect(() => {
    if (!requestedPlugin || !BUILT_IN_PLUGINS.some(plugin => plugin.id === requestedPlugin)) return
    const frame = window.requestAnimationFrame(() => {
      const card = cardRefs.current.get(requestedPlugin)
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      card?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [requestedPlugin])

  function persist(change: (current: PluginLocalPreferences) => PluginLocalPreferences, successMessage: string) {
    if (!isQbankSessionCurrent(session.current)) { toast.err('账号已切换，请重新选择插件'); return }
    const next = change(readPluginPreferences(uid))
    if (!writePluginPreferences(uid, next)) {
      toast.err('本机存储不可用，插件设置未保存')
      return
    }
    setPreferences(next)
    toast.ok(successMessage)
  }

  function toggle(plugin: OhuPluginManifest) {
    const enabled = preferences.enabled.includes(plugin.id)
    persist(current => ({ ...current, enabled: enabled ? current.enabled.filter(id => id !== plugin.id) : [...new Set([...current.enabled, plugin.id])] }), enabled ? `已停用${plugin.name}` : `已启用${plugin.name}`)
  }

  function rate(plugin: OhuPluginManifest, score: number) {
    persist(current => ({ ...current, ratings: { ...current.ratings, [plugin.id]: score } }), `已记录 ${score} 星评分`)
  }

  return (
    <div className={styles.root}>
      <div className={styles.sectionHeading}>
        <div><b>哦狐内置插件</b><span>简单、轻量，随 APK 一起安装</span></div>
        <span className={styles.count}>{BUILT_IN_PLUGINS.length} 个</span>
      </div>
      <div className={styles.cards}>
        {BUILT_IN_PLUGIN_MODULES.map(({ manifest: plugin, Controls, icon }) => {
          const enabled = preferences.enabled.includes(plugin.id)
          const rating = preferences.ratings[plugin.id] || 0
          return (
            <article className={styles.card} key={plugin.id} tabIndex={-1} data-plugin-id={plugin.id} ref={node => { if (node) cardRefs.current.set(plugin.id, node); else cardRefs.current.delete(plugin.id) }}>
              <div className={styles.cardTop}>
                <span className={styles.icon}><CampusIcon name={icon} /></span>
                <span className={styles.bundled}>{plugin.official ? '哦狐官方模块' : plugin.category === '趣味探索' ? '非官方 · 趣味内容' : '非官方 · 学习工具'}</span>
              </div>
              <h4>{plugin.name}</h4>
              <p>{plugin.summary}</p>
              <div className={styles.meta}><span>{plugin.category}</span><span>v{plugin.version}</span><span>创作者：{plugin.author}</span>{plugin.permissions.map((permission) => <span key={permission}>使用：{PERMISSION_LABELS[permission]}</span>)}</div>
              {plugin.sourceHref ? <p className={styles.attribution}>来源与许可：{plugin.sourceLicense} · <a href={plugin.sourceHref} target="_blank" rel="noopener noreferrer">{plugin.sourceName} ↗</a></p> : null}
              {enabled ? <Controls enabled onToggle={() => toggle(plugin)} /> : <div className={styles.actions}><button type="button" className={styles.enable} aria-label={`启用${plugin.name}`} aria-pressed={false} onClick={() => toggle(plugin)}>未使用 · 点击启用</button></div>}
              <div className={styles.rating}>
                <span>给插件评分</span>
                <div role="group" aria-label={`为${plugin.name}评分`} className={styles.stars}>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button key={score} type="button" onClick={() => rate(plugin, score)} aria-label={`${score} 星`} aria-pressed={rating === score} className={rating >= score ? styles.starActive : styles.star}>
                      ★
                    </button>
                  ))}
                  <span>{rating ? `${rating}/5` : '未评分'}</span>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <p className={styles.ratingNote}>星级是保存在本机、按当前账号区分的个人评分，不是全站平均分；不会公开或同步到其他设备。</p>
      <details className={styles.guide}>
        <summary>插件作者工作流：从提交到上架</summary>
        <ol>
          <li>把插件源码、清单、README、许可证和运行截图放进一个可公开查看的 GitHub 仓库。哦狐目前不接收 APK 内动态下载，也没有源码附件上传入口。</li>
          <li>按 v1 格式写清插件 ID、版本、用途、哦狐内入口、所需权限、数据处理方式、网络请求、依赖和兼容范围；提交前本地运行并注明实际检查结果。</li>
          <li>点击“提交插件接入方案”，在表单粘贴仓库地址和说明。请勿提交密钥、密码、教务账号或真实用户资料。</li>
          <li>管理员审核代码来源、许可证、安全、隐私和校园适用性。通过后由哦狐维护者静态接入源码并登记来源声明、构建和发布新版；用户更新哦狐后才能启用。</li>
          <li>不接受远程脚本、APK 直装或绕过平台规则的自动刷课／代答插件；独立 Android 应用只作为外部项目链接，不宣称可在哦狐内运行。</li>
        </ol>
      </details>
      <details className={styles.guide}>
        <summary>我是用户：如何启用和使用？</summary>
        <ol>
          <li>打开“服务 → 哦狐插件”，或“我的 → 哦狐科技”，查看插件用途、版本和权限说明。</li>
          <li>每张插件卡都可以单独选择“启用”或“停用”；启用后会自动加入“服务 → 已启用插件”功能区，停用后从功能区移除。选择会按当前账号保存在本机，下次打开仍会记住。</li>
          <li>星级按钮用于记录你自己的体验评分；当前只保存在本机，不会公开给其他同学。</li>
          <li>每个内置插件的来源与许可见该插件卡片；插件已由哦狐审核并静态打包，来源仓库不会在 App 里被下载或执行。</li>
        </ol>
      </details>
      <div className={styles.rule}>
        <b>插件格式与接入规则</b>
        <p>哦狐插件采用固定清单 + TypeScript/React 模块：填写插件 ID、版本、名称、分类、简介、入口和最小权限。第三方灵感或来源会标“非官方”，并列出仓库和许可证。管理员审查源码、许可证、隐私和权限后，将模块静态注册并随下一版 APK 构建。APK 不从 GitHub 拉取或运行远程代码。自动刷课、自动答题和伪造学习进度的插件不予接入。</p>
        <Link to="/contact?topic=plugin">提交插件接入方案 <span aria-hidden="true">›</span></Link>
      </div>
    </div>
  )
}
