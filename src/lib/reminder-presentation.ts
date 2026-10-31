import type { Channel, LocalNotificationSchema } from '@capacitor/local-notifications'
import { ensureAlarmChannel, idleSchedule, type AlarmChannelState } from './alarm-notify'
import { IS_NATIVE, PLATFORM } from './platform'
import { courseReminderExpiry } from './course-reminder-expiry'

export type ReminderStyle = 'normal' | 'quiet' | 'important'
export type ReminderScope = 'class' | 'exam' | 'todo'
export type ReminderKind = 'class-soon' | 'class-start' | 'exam' | 'todo'
export const REMINDER_VIEW_ACTION_ID = 'view-reminder'
export const REMINDER_STYLE_EVENT = 'ohhu-reminder-style-change'
export const REMINDER_STYLE_OPTIONS: readonly { value: ReminderStyle; label: string; hint: string }[] = [
  { value: 'normal', label: '普通提醒', hint: '标准通知渠道；显示与声音由系统设置决定' },
  { value: 'quiet', label: '安静提醒', hint: '低优先级渠道，默认无声音和震动' },
  { value: 'important', label: '重要提醒', hint: '较高优先级渠道；横幅和锁屏由系统决定' },
]
const scopeMeta = {
  class: { title: '上课提醒', legacyChannel: 'class-remind-v2', route: '/schedule', actionTitle: '查看课表' },
  exam: { title: '考试提醒', legacyChannel: 'exam-remind-v2', route: '/study?tab=exams', actionTitle: '查看考试' },
  todo: { title: '待办提醒', legacyChannel: 'todo-remind-v1', route: '/todo', actionTitle: '查看待办' },
} as const
const kindLabels: Record<ReminderKind, string> = { 'class-soon': '课前提醒', 'class-start': '开课提醒', exam: '考试提醒', todo: '待办提醒' }
const styleKey = (scope: ReminderScope) => `reminder.presentation.${scope}`
const validStyle = (value: unknown): value is ReminderStyle => value === 'normal' || value === 'quiet' || value === 'important'
const scopeOf = (kind: ReminderKind): ReminderScope => kind === 'class-soon' || kind === 'class-start' ? 'class' : kind

function savedStyle(scope: ReminderScope): ReminderStyle | null {
  try { const value = localStorage.getItem(styleKey(scope)); return validStyle(value) ? value : null } catch { return null }
}
/** Missing/invalid preferences preserve the preexisting important channel. */
export function getReminderStyle(scope: ReminderScope = 'class'): ReminderStyle { return savedStyle(scope) ?? 'important' }
export function hasSavedReminderStyle(scope: ReminderScope = 'class'): boolean { return savedStyle(scope) !== null }
/** Persistence only: the caller must reschedule that category's future notices. */
export function setReminderStyle(style: ReminderStyle, scope: ReminderScope = 'class'): void {
  if (!validStyle(style)) throw new Error('未知的提醒样式')
  localStorage.setItem(styleKey(scope), style)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REMINDER_STYLE_EVENT, { detail: { scope, style } }))
}

const CLASS_EFFECTS_KEY = 'reminder.effects.class.v1'
export type ClassReminderEffects = { sound: boolean; vibration: boolean; configured: boolean }
function savedClassEffects(): { sound: boolean; vibration: boolean } | null {
  try {
    const value = JSON.parse(localStorage.getItem(CLASS_EFFECTS_KEY) || 'null')
    return value && typeof value.sound === 'boolean' && typeof value.vibration === 'boolean' ? { sound: value.sound, vibration: value.vibration } : null
  } catch { return null }
}
/** Untouched users keep their existing Android channel and any system customization. */
export function getClassReminderEffects(style: ReminderStyle = getReminderStyle()): ClassReminderEffects {
  const saved = savedClassEffects()
  return saved ? { ...saved, configured: true } : { sound: style !== 'quiet', vibration: style !== 'quiet', configured: false }
}
/** Persistence only; callers refresh the course plan after a successful write. */
export function setClassReminderEffects(effects: Pick<ClassReminderEffects, 'sound' | 'vibration'>): void {
  if (typeof effects.sound !== 'boolean' || typeof effects.vibration !== 'boolean') throw new Error('铃声与震动设置无效')
  localStorage.setItem(CLASS_EFFECTS_KEY, JSON.stringify({ sound: effects.sound, vibration: effects.vibration }))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REMINDER_STYLE_EVENT, { detail: { scope: 'class', effects } }))
}

export type ReminderPresentation = {
  kind: ReminderKind
  scope: ReminderScope
  style: ReminderStyle
  styleLabel: string
  channelId: string
  channel: Channel
  legacyChannel: boolean
  actionTypeId: string
  route: string
  stateHint: string
  effects?: ClassReminderEffects
  extra: { type: ReminderScope; reminderKind: ReminderKind; reminderStyle: ReminderStyle; route: string }
}
/** Pure policy; it does not create a channel, request permission or send a notice. */
export function getReminderPresentation(kind: ReminderKind, override?: ReminderStyle): ReminderPresentation {
  if (override !== undefined && !validStyle(override)) throw new Error('未知的提醒样式')
  const scope = scopeOf(kind), saved = savedStyle(scope), style = override ?? saved ?? 'important'
  const meta = scopeMeta[scope], styleLabel = REMINDER_STYLE_OPTIONS.find((option) => option.value === style)!.label
  const effects = scope === 'class' ? getClassReminderEffects(style) : undefined
  const explicitEffects = effects?.configured === true
  const legacyChannel = override === undefined && saved === null && !explicitEffects
  const channelId = explicitEffects ? `class-remind-${style}-s${Number(effects.sound)}v${Number(effects.vibration)}-v4` : legacyChannel ? meta.legacyChannel : `${scope}-remind-${style}-v3`
  const importance = explicitEffects ? style === 'important' ? 4 : effects.sound || effects.vibration ? 3 : 2 : style === 'quiet' ? 2 : style === 'normal' ? 3 : legacyChannel ? 5 : 4
  const effectLabel = explicitEffects ? `${effects.sound ? '铃声' : '无铃声'} · ${effects.vibration ? '震动' : '无震动'}` : ''
  return {
    kind, scope, style, styleLabel, channelId, legacyChannel,
    ...(effects ? { effects } : {}),
    channel: { id: channelId, name: `${meta.title} · ${explicitEffects ? effectLabel : styleLabel}`, description: `${meta.title}的${styleLabel}渠道；显示方式由系统设置决定`, importance, visibility: 1, vibration: explicitEffects ? effects.vibration : style !== 'quiet' },
    actionTypeId: `ohhu-${scope}-view-v1`, route: meta.route,
    stateHint: explicitEffects ? '已按铃声与震动组合选择课程渠道；可在系统中选具体铃声。系统静音、音量、勿扰及渠道自定义仍优先。' : legacyChannel
      ? '保留原通知渠道及系统偏好；若没有声音，请在该渠道的系统通知设置中选择铃声。再次选择重要提醒会使用新的重要渠道。'
      : '选择样式只改变后续重排使用的渠道；横幅、锁屏、声音和震动最终由系统及渠道设置决定。',
    extra: { type: scope, reminderKind: kind, reminderStyle: style, route: meta.route },
  }
}

let actionsReady: Promise<void> | null = null
async function ensureActions(): Promise<void> {
  if (!IS_NATIVE) return
  if (!actionsReady) {
    actionsReady = import('@capacitor/local-notifications').then(({ LocalNotifications }) => LocalNotifications.registerActionTypes({
      types: [
        ...(Object.keys(scopeMeta) as ReminderScope[]).map((scope) => ({ id: `ohhu-${scope}-view-v1`, actions: [{ id: REMINDER_VIEW_ACTION_ID, title: scopeMeta[scope].actionTitle, foreground: true }] })),
        { id: 'ohhu-self-test-view-v1', actions: [{ id: REMINDER_VIEW_ACTION_ID, title: '查看提醒设置', foreground: true }] },
      ],
    })).catch((error) => { actionsReady = null; throw error })
  }
  await actionsReady
}
/** Creates only the selected channel and action metadata; never posts a notification. */
export async function prepareReminderPresentation(kind: ReminderKind, style?: ReminderStyle): Promise<ReminderPresentation & { channelState: AlarmChannelState }> {
  const presentation = getReminderPresentation(kind, style)
  const channelState = await ensureAlarmChannel(presentation.channelId, presentation.channel.name, presentation.channel.description ?? '', { ...presentation.channel, ...(presentation.effects?.configured ? { soundEnabled: presentation.effects.sound } : {}) })
  await ensureActions()
  const stateHint = !channelState.supported && PLATFORM.os === 'android'
    ? '旧系统不支持通知渠道样式；安静提醒请在系统通知管理中静音，横幅和锁屏显示由系统决定。'
    : channelState.channel?.importance === 0 ? `当前通知渠道已关闭，请到系统通知设置开启。${presentation.stateHint}` : presentation.stateHint
  return { ...presentation, stateHint, channelState }
}

export type ReminderNotificationInput = { id: number; title: string; body: string; at: Date; reminderAt?: Date; classStartAt?: Date; classEndAt?: Date; courseAlarmClock?: boolean; ownerUid?: string; selfTest?: boolean; restoreAfterReboot?: boolean }
/** Keep the account owner and distinct event meaning on both scheduled and immediate notices. */
export function buildReminderNotification(presentation: ReminderPresentation, input: ReminderNotificationInput): LocalNotificationSchema {
  if (!Number.isFinite(input.at.getTime()) || (input.reminderAt && !Number.isFinite(input.reminderAt.getTime()))) throw new Error('提醒时间无效')
  const course = presentation.scope === 'class' && !input.selfTest
  const reminderAt = (input.reminderAt ?? input.at).getTime()
  const personalTimedReminder = presentation.kind === 'todo' || presentation.kind === 'exam'
  const expiry = course ? courseReminderExpiry(presentation.kind, reminderAt, input.classStartAt?.getTime(), input.classEndAt?.getTime())
    : personalTimedReminder ? reminderAt + 60_000 : undefined
  if ((course || personalTimedReminder) && !Number.isFinite(expiry)) throw new Error(course ? '课程起止时间无效' : '提醒时间无效')
  return {
    id: input.id, title: input.title, body: input.body, largeBody: input.body,
    summaryText: input.selfTest ? '提醒自检' : kindLabels[presentation.kind],
    schedule: idleSchedule(input.at), channelId: presentation.channelId, actionTypeId: input.selfTest ? 'ohhu-self-test-view-v1' : presentation.actionTypeId, autoCancel: true,
    extra: {
      ...presentation.extra,
      ...(course || personalTimedReminder ? { expiresAt: new Date(expiry!).toISOString() } : {}),
      ...(course && input.classStartAt ? { classStartAt: input.classStartAt.toISOString() } : {}),
      ...(course && input.classEndAt ? { classEndAt: input.classEndAt.toISOString() } : {}),
      ...(course && input.courseAlarmClock !== undefined ? { courseAlarmClock: input.courseAlarmClock } : {}),
      ...(input.ownerUid ? { ownerUid: input.ownerUid } : {}), ...(input.selfTest ? { type: 'self-test', route: '/settings' } : {}), ...(input.selfTest && input.ownerUid && input.restoreAfterReboot ? { restoreAfterReboot: true } : {}), reminderAt: (input.reminderAt ?? input.at).toISOString(),
    },
  }
}
