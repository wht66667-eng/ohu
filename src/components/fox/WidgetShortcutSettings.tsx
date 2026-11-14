import { useState } from 'react'
import {
  DEFAULT_WIDGET_SHORTCUTS,
  WIDGET_SHORTCUT_OPTIONS,
  isAndroidWidgetPlatform,
  isWidgetShortcut,
  readWidgetShortcuts,
  writeWidgetShortcuts,
  type WidgetShortcut,
} from '../../lib/widget-shortcuts'
import { useUiVariant } from '../../lib/ui-variant'
import styles from './WidgetShortcutSettings.module.css'

export function WidgetShortcutSettings() {
  const variant = useUiVariant()
  const [routes, setRoutes] = useState(readWidgetShortcuts)
  const [message, setMessage] = useState('')

  if (variant !== 'pure' || !isAndroidWidgetPlatform()) return null

  function save(next: WidgetShortcut[]) {
    try {
      writeWidgetShortcuts(next)
      setRoutes(next)
      setMessage('已保存快捷入口')
    } catch {
      setMessage('无法保存，请检查设备储存空间')
    }
  }

  function changeSlot(index: number, value: string) {
    if (!isWidgetShortcut(value)) return
    const previousSlot = routes.indexOf(value)
    const next = [...routes]
    if (previousSlot >= 0) next[previousSlot] = routes[index]
    next[index] = value
    save(next)
  }

  return (
    <section className={styles.panel} aria-labelledby="widget-shortcuts-title">
      <h3 id="widget-shortcuts-title">桌面快捷组件</h3>
      <p>在安卓桌面添加「简单 · 快捷入口」，再选择四个位置打开的功能。</p>
      <div className={styles.positions}>
        {routes.map((route, index) => (
          <label key={index}>
            {['左上', '右上', '左下', '右下'][index]}
            <select value={route} onChange={(event) => changeSlot(index, event.target.value)}>
              {WIDGET_SHORTCUT_OPTIONS.map(({ route: target, label }) => (
                <option key={target} value={target}>{label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => save([...DEFAULT_WIDGET_SHORTCUTS])}>恢复默认入口</button>
      <p role="status">{message}</p>
    </section>
  )
}
