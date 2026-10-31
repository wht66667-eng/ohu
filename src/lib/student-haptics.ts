import { Capacitor, registerPlugin } from '@capacitor/core'

const haptics = registerPlugin<{ tap(): Promise<{ performed: boolean }> }>('StudentHaptics')

export function studentHaptic(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return
  void haptics.tap().catch(() => undefined)
}

/** Only designated student actions use system touch feedback. */
export function installStudentHaptics(): () => void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return () => {}
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button:not(:disabled)')
    if (!button || button.getAttribute('aria-disabled') === 'true') return
    const label = (button.getAttribute('aria-label') || button.textContent || '').trim()
    if (!/发布|保存|(?:开始|完成)专注|点赞|收藏/.test(label)) return
    studentHaptic()
  }
  document.addEventListener('click', click, true)
  return () => document.removeEventListener('click', click, true)
}
