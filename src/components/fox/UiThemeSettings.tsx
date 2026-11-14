import { useState } from 'react'
import { chooseUiVariant, useUiVariant, type SelectableUiVariant } from '../../lib/ui-variant'
import { ensureHanddrawnFonts } from '../../lib/font-pref'
import { CompanionSettings } from './CompanionSettings'
import { FontLibrarySettings } from './FontLibrarySettings'
import { ServiceLayoutSettings } from './ServiceLayoutSettings'
import { WidgetShortcutSettings } from './WidgetShortcutSettings'
import { isAndroidWidgetPlatform } from '../../lib/widget-shortcuts'
import styles from './UiThemeSettings.module.css'

const skinNames = { classic: '经典版', pure: '简单版', companion: '微绿版', handdrawn: '手绘版', ink: '水墨版' } satisfies Record<SelectableUiVariant, string>
const widgets = {
  classic: '经典 · 阿狐问候',
  companion: '微绿 · 下一节课',
  handdrawn: '手绘 · 待办便签',
} as const

export function UiThemeSettings() {
  const variant = useUiVariant()
  const [message, setMessage] = useState('')
  function choose(next: SelectableUiVariant) {
    try {
      chooseUiVariant(next)
      if (next === 'handdrawn') void ensureHanddrawnFonts()
      setMessage(`已切换为${skinNames[next]}`)
    } catch (error) { setMessage((error as Error).message) }
  }
  return <section className={styles.panel} aria-label="界面版本">
    <h3>界面版本</h3>
    <p>默认使用微绿版。每款皮肤的首页顺序和服务布局可分别调整。</p>
    <div className={styles.choices}>
      <div className={`${styles.option} ${styles.inkOption}`}>
        <button type="button" aria-pressed={variant === 'ink'} onClick={() => choose('ink')}>
          <span className={styles.inkPreview} aria-hidden="true">
            <span>水墨版 <small>墨滴阿狐 · 黑白纸面</small></span>
            <img src="/brand/ink/ink-fox.svg" width="102" height="83" alt="" />
          </span>
          <small>墨笺标题、深浅墨阶与纵向目录</small>
          <span className={styles.state}>{variant === 'ink' ? '使用中' : '切换到水墨版'}</span>
        </button>
      </div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'classic'} onClick={() => choose('classic')}><span className={`${styles.preview} ${styles.classic}`} aria-hidden="true"><i /><i /><i /></span><strong>经典版</strong><small>阿狐课表首页，暖色双列服务卡</small><span className={styles.state}>{variant === 'classic' ? '使用中' : '切换到经典版'}</span></button></div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'handdrawn'} onClick={() => choose('handdrawn')}><span className={`${styles.preview} ${styles.hand}`} aria-hidden="true"><i /><i /><i /></span><strong>手绘版</strong><small>每日手账、手写标题与服务页签</small><span className={styles.state}>{variant === 'handdrawn' ? '使用中' : '切换到手绘版'}</span></button></div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'companion'} onClick={() => choose('companion')}><span className={`${styles.preview} ${styles.pure}`} aria-hidden="true"><i /><i /><i /></span><strong>微绿版 · 默认</strong><small>白底绿标，先看常用功能网格</small><span className={styles.state}>{variant === 'companion' ? '使用中' : '切换到微绿版'}</span></button></div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'pure'} onClick={() => choose('pure')}><span className={`${styles.preview} ${styles.simple}`} aria-hidden="true"><i /><i /><i /></span><strong>简单版</strong><small>灰度配色、课表概览与常用功能网格</small><span className={styles.state}>{variant === 'pure' ? '使用中' : '切换到简单版'}</span></button></div>
    </div>
    <p role="status" className={styles.message}>{message}</p>
    <ServiceLayoutSettings />
    {isAndroidWidgetPlatform() && (variant === 'classic' || variant === 'companion' || variant === 'handdrawn')
      ? <section aria-label="手机桌面小组件"><h3>手机桌面小组件</h3><p>长按安卓桌面空白处，在小组件列表中添加「{widgets[variant]}」。</p></section>
      : null}
    <WidgetShortcutSettings />
    <FontLibrarySettings />
    <CompanionSettings />
  </section>
}
