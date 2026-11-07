import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { captureQbankSession, subscribeQbank } from '../lib/qbank'
import { PLUGIN_PREFERENCES_EVENT, pluginPreferencesKey, readPluginPreferences } from '../plugins/plugin-manifest'
import { BUILT_IN_PLUGIN_MODULES } from '../plugins/registry'
import { CampusIcon } from './CampusIcon'
import styles from './EnabledPluginFeatures.module.css'

function featurePath(pluginId: string, entryPath: string): string {
  return entryPath === '/plugins' ? `/plugins/${encodeURIComponent(pluginId)}` : entryPath
}

export function EnabledPluginFeatures() {
  const auth = useAuth()
  const revision = useSyncExternalStore(subscribeQbank, () => captureQbankSession().revision, () => 0)
  const uid = auth.isSigned ? auth.user?.uid || null : null
  if ((captureQbankSession().uid || null) !== uid) return null
  return <AccountEnabledPluginFeatures key={`${uid || 'guest'}:${revision}`} uid={uid} />
}

function AccountEnabledPluginFeatures({ uid }: { uid: string | null }) {
  const [enabled, setEnabled] = useState(() => readPluginPreferences(uid).enabled)
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    const load = () => setEnabled(readPluginPreferences(uid).enabled)
    const storage = (event: StorageEvent) => { if (!event.key || event.key === pluginPreferencesKey(uid)) load() }
    const changed = (event: Event) => { if (((event as CustomEvent<string | null>).detail || null) === uid) load() }
    window.addEventListener('storage', storage)
    window.addEventListener(PLUGIN_PREFERENCES_EVENT, changed)
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(PLUGIN_PREFERENCES_EVENT, changed) }
  }, [uid])

  const plugins = BUILT_IN_PLUGIN_MODULES.filter(({ manifest }) => enabled.includes(manifest.id))

  return <section className={styles.section} data-expanded={expanded} aria-labelledby="enabled-plugin-features-title">
    <div className={styles.heading}>
      <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls="enabled-plugin-feature-list" onClick={() => setExpanded(value => !value)}>
        <span><span id="enabled-plugin-features-title" className={styles.title} role="heading" aria-level={2}><span aria-hidden="true">✦</span>已启用插件</span><p>{plugins.length ? `${plugins.length} 项插件 · 点击收起或展开` : '在插件商城启用后，会自动出现在这里'}</p></span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </button>
      <Link to="/plugins">管理</Link>
    </div>
    <div className={styles.grid} id="enabled-plugin-feature-list" hidden={!expanded}>
      {plugins.length ? plugins.map(({ manifest, icon }) => <Link className={styles.feature} to={featurePath(manifest.id, manifest.entryPath)} key={manifest.id}>
          <span className={styles.icon} aria-hidden="true"><CampusIcon name={icon} /></span>
          <span className={styles.copy}><b>{manifest.name}</b><small>{manifest.summary}</small></span>
          <span className={styles.arrow} aria-hidden="true">›</span>
        </Link>)
        : <div className={styles.empty}><span>还没有启用插件</span><Link to="/plugins">去插件商城选择</Link></div>}
    </div>
  </section>
}
