import { useState } from 'react'
import { DialogLayer } from '../../components/ui/DialogLayer'
import type { UiVariant } from '../../lib/ui-variant'
import { defaultHomeSkinLayout, HOME_SECTIONS, HOME_SHORTCUTS, type HomeSkinLayout } from './home-skin-layout'
import styles from '../SimpleHomePage.module.css'

function move<T>(items: T[], index: number, offset: number) {
  const destination = index + offset
  if (destination < 0 || destination >= items.length) return items
  const next = [...items]
  const moved = next[index]
  next[index] = next[destination]
  next[destination] = moved
  return next
}

export function HomeLayoutDialog({ skin, initial, onClose, onSave }: {
  skin: UiVariant
  initial: HomeSkinLayout
  onClose: () => void
  onSave: (layout: HomeSkinLayout) => void
}) {
  const [draft, setDraft] = useState(initial)
  const reorder = (field: 'shortcuts' | 'sections', index: number, offset: number) => {
    setDraft(value => field === 'shortcuts'
      ? { ...value, shortcuts: move(value.shortcuts, index, offset) }
      : { ...value, sections: move(value.sections, index, offset) })
  }
  return <DialogLayer title="调整首页" className={styles.layoutDialog} onClose={onClose}>
    <header className={styles.layoutHead}>
      <h2>调整首页</h2>
      <button type="button" aria-label="关闭首页设置" onClick={onClose}>×</button>
    </header>
    <p>这款皮肤会单独记住常用入口和区块顺序。</p>
    <fieldset>
      <legend>常用入口</legend>
      <ol>
        {draft.shortcuts.map((id, index) => {
          const label = HOME_SHORTCUTS.find(item => item.id === id)?.label ?? id
          return <li key={id}>
            <span>{label}</span>
            <button type="button" aria-label={`上移${label}入口`} disabled={index === 0} onClick={() => reorder('shortcuts', index, -1)}>↑</button>
            <button type="button" aria-label={`下移${label}入口`} disabled={index === draft.shortcuts.length - 1} onClick={() => reorder('shortcuts', index, 1)}>↓</button>
            <button type="button" aria-label={`移除${label}入口`} disabled={draft.shortcuts.length === 1} onClick={() => setDraft(value => ({ ...value, shortcuts: value.shortcuts.filter(item => item !== id) }))}>移除</button>
          </li>
        })}
      </ol>
      <label className={styles.layoutAdd}>添加入口
        <select value="" disabled={draft.shortcuts.length >= 6} onChange={event => {
          const shortcut = HOME_SHORTCUTS.find(item => item.id === event.target.value)
          if (shortcut) setDraft(value => ({ ...value, shortcuts: [...value.shortcuts, shortcut.id] }))
        }}>
          <option value="">{draft.shortcuts.length >= 6 ? '已选满六项' : '选择常用服务'}</option>
          {HOME_SHORTCUTS.filter(item => !draft.shortcuts.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
    </fieldset>
    <fieldset>
      <legend>首页区块</legend>
      <ol>
        {draft.sections.map((id, index) => {
          const label = HOME_SECTIONS.find(item => item.id === id)?.label ?? id
          return <li key={id}>
            <span>{label}</span>
            <button type="button" aria-label={`上移${label}区块`} disabled={index === 0} onClick={() => reorder('sections', index, -1)}>↑</button>
            <button type="button" aria-label={`下移${label}区块`} disabled={index === draft.sections.length - 1} onClick={() => reorder('sections', index, 1)}>↓</button>
          </li>
        })}
      </ol>
    </fieldset>
    <footer className={styles.layoutActions}>
      <button type="button" onClick={() => setDraft(defaultHomeSkinLayout(skin))}>恢复默认</button>
      <button type="button" onClick={() => onSave(draft)}>保存布局</button>
    </footer>
  </DialogLayer>
}
