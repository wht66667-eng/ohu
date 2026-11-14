import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SERVICE_CATALOG, SERVICE_GROUPS } from '../../lib/service-catalog'
import {
  defaultServicePins, getServiceLayoutPreferences, saveServiceLayoutPreferences,
  SERVICE_PIN_LIMIT, useServiceLayoutPreferences, type ServiceLayoutMode,
  type ServiceLayoutPreferences,
} from '../../lib/service-layout'
import { useUiVariant } from '../../lib/ui-variant'
import styles from './ServiceLayoutSettings.module.css'

const services = new Map(SERVICE_CATALOG.map(item => [item.id, item]))
const MODES: ReadonlyArray<{ id: ServiceLayoutMode; label: string }> = [
  { id: 'auto', label: '跟随皮肤' },
  { id: 'grid', label: '卡片网格' },
  { id: 'list', label: '功能清单' },
]

export function ServiceLayoutSettings() {
  const skin = useUiVariant()
  const preferences = useServiceLayoutPreferences(skin)
  const pinned = preferences.pinned ?? defaultServicePins(skin)
  const [feedback, setFeedback] = useState<{ skin: string; text: string } | null>(null)

  function save(update: Partial<ServiceLayoutPreferences>, message: string) {
    const current = getServiceLayoutPreferences(skin)
    const stored = saveServiceLayoutPreferences(skin, { ...current, ...update })
    setFeedback({ skin, text: stored ? message : '本次已应用。此设备暂时无法保存偏好，刷新后可能恢复。' })
  }

  function changeOrder(id: string, nextIndex: number) {
    const list = [...pinned]
    const previous = list.indexOf(id)
    if (previous < 0 || nextIndex === previous || nextIndex < 0 || nextIndex >= list.length) return
    list.splice(previous, 1)
    list.splice(nextIndex, 0, id)
    save({ pinned: list }, `已将${services.get(id)?.title ?? '服务'}移到第 ${nextIndex + 1} 位`)
  }

  return <section className={styles.panel} aria-labelledby="service-layout-title">
    <header className={styles.header}>
      <h3 id="service-layout-title">服务页布局</h3>
      <Link to="/services">查看服务页</Link>
    </header>
    <p>选择目录样式和常用入口。每款皮肤的设置会分别保存在本机。</p>
    <div className={styles.modes} role="group" aria-label="服务目录样式">
      {MODES.map(mode => <button key={mode.id} type="button" aria-pressed={preferences.mode === mode.id} onClick={() => save({ mode: mode.id }, `已应用${mode.label}`)}>{mode.label}</button>)}
    </div>
    <h4>常用入口 <span>{pinned.length}/{SERVICE_PIN_LIMIT}</span></h4>
    <p>固定 1–{SERVICE_PIN_LIMIT} 项，可调整顺序。完整目录仍可浏览和搜索。</p>
    <ol className={styles.pins}>
      {pinned.map((id, index) => {
        const title = services.get(id)?.title
        if (!title) return null
        return <li key={id} className={styles.pin}>
          <span>{title}</span>
          <label className={styles.position}>
            <span>位置</span>
            <select aria-label={`${title}的顺序`} value={index} onChange={event => changeOrder(id, Number(event.target.value))}>
              {pinned.map((item, position) => <option key={item} value={position}>第 {position + 1} 位</option>)}
            </select>
          </label>
          <button type="button" aria-label={`移除${title}`} disabled={pinned.length <= 1} onClick={() => save({ pinned: pinned.filter(item => item !== id) }, `已移除${title}快捷入口`)}>移除</button>
        </li>
      })}
    </ol>
    <label className={styles.add}>
      添加常用服务
      <select value="" disabled={pinned.length >= SERVICE_PIN_LIMIT} onChange={event => {
        const service = services.get(event.target.value)
        if (service && !pinned.includes(service.id) && pinned.length < SERVICE_PIN_LIMIT) {
          save({ pinned: [...pinned, service.id] }, `已固定${service.title}`)
        }
      }}>
        <option value="">{pinned.length >= SERVICE_PIN_LIMIT ? '已满，先移除一项再添加' : '选择服务'}</option>
        {SERVICE_GROUPS.map(group => <optgroup key={group.id} label={group.title}>
          {group.ids.flatMap(id => {
            const item = services.get(id)
            return item && !pinned.includes(id) ? [<option key={id} value={id}>{item.title}</option>] : []
          })}
        </optgroup>)}
      </select>
    </label>
    <button type="button" className={styles.reset} disabled={preferences.mode === 'auto' && preferences.pinned === null} onClick={() => save({ mode: 'auto', pinned: null }, '已恢复此皮肤的默认服务布局和常用入口')}>恢复此皮肤默认设置</button>
    <p className={styles.status} role="status">{feedback?.skin === skin ? feedback.text : ''}</p>
  </section>
}
