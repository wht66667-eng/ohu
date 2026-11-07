import { BUILT_IN_PLUGINS } from './plugin-manifest'
import { FocusShortcut } from './builtin/FocusShortcut'
import { ScheduleReminder } from './builtin/ScheduleReminder'
import { BirthdayNumberPlay, TarotReflection, ZodiacReflection } from './builtin/PlayfulReadings'
import { QuickQuiz, ReviewCards } from './builtin/StudyTools'
import { FoxSafety } from './builtin/FoxSafety'

/** 静态注册表：每个组件经人工审查后显式导入，构建工具将其打入 Web 与 APK。 */
export const BUILT_IN_PLUGIN_MODULES = [
  { manifest: BUILT_IN_PLUGINS[0], Controls: FocusShortcut, icon: 'sun' },
  { manifest: BUILT_IN_PLUGINS[1], Controls: ScheduleReminder, icon: 'cal' },
  { manifest: BUILT_IN_PLUGINS[2], Controls: TarotReflection, icon: 'flash' },
  { manifest: BUILT_IN_PLUGINS[3], Controls: ZodiacReflection, icon: 'moon' },
  { manifest: BUILT_IN_PLUGINS[4], Controls: BirthdayNumberPlay, icon: 'book' },
  { manifest: BUILT_IN_PLUGINS[5], Controls: ReviewCards, icon: 'book' },
  { manifest: BUILT_IN_PLUGINS[6], Controls: QuickQuiz, icon: 'check' },
  { manifest: BUILT_IN_PLUGINS[7], Controls: FoxSafety, icon: 'shield' },
] as const

if (new Set(BUILT_IN_PLUGIN_MODULES.map((plugin) => plugin.manifest.id)).size !== BUILT_IN_PLUGIN_MODULES.length) {
  throw new Error('内置插件 ID 必须唯一')
}
