import { useEffect } from 'react'
import { keyboardViewport } from './keyboard-viewport'

/**
 * One visible viewport for the shell, dialogs and composers. visualViewport handles
 * browser/iOS keyboard panning; Android WindowInsets is an overlay-mode fallback.
 * Never add the keyboard height again to individual input bars.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let baselineHeight = window.innerHeight
    let baselineWidth = window.innerWidth
    let previousHeight = baselineHeight
    let frame = 0
    let focusFrame = 0
    const apply = () => {
      const active = document.activeElement
      const editing = active instanceof HTMLElement && active.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable=true]')
      const nativeImeHeight = Number.parseFloat(root.style.getPropertyValue('--native-ime-inset')) || 0
      if (window.innerWidth !== baselineWidth || (!editing && nativeImeHeight === 0)) {
        baselineHeight = window.innerHeight
        baselineWidth = window.innerWidth
      }
      const visible = keyboardViewport({ layoutHeight: window.innerHeight, baselineHeight,
        visualHeight: viewport?.height, visualOffsetTop: viewport?.offsetTop, visualScale: viewport?.scale,
        nativeImeHeight, editing })
      if (!visible.keyboardOpen && !nativeImeHeight) baselineHeight = window.innerHeight
      root.style.setProperty('--app-viewport-height', `${Math.round(visible.height)}px`)
      root.style.setProperty('--app-viewport-top', `${Math.round(visible.offsetTop)}px`)
      root.toggleAttribute('data-keyboard-open', visible.keyboardOpen)
      if (visible.keyboardOpen && visible.height !== previousHeight && active instanceof HTMLElement) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
      }
      previousHeight = visible.height
    }
    apply()
    viewport?.addEventListener('resize', apply)
    viewport?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    window.addEventListener('app-native-insets', apply)
    document.addEventListener('focusin', apply)
    const afterFocusChange = () => {
      cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(apply)
    }
    document.addEventListener('focusout', afterFocusChange)
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(focusFrame)
      viewport?.removeEventListener('resize', apply)
      viewport?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      window.removeEventListener('app-native-insets', apply)
      document.removeEventListener('focusin', apply)
      document.removeEventListener('focusout', afterFocusChange)
      root.style.removeProperty('--app-viewport-height')
      root.style.removeProperty('--app-viewport-top')
      root.removeAttribute('data-keyboard-open')
    }
  }, [])
}
