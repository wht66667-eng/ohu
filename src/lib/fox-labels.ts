/**
 * 小狐狸台词表（唯一真相源）
 *
 * 原先这份数据同时散落在 design/sunny-fox/icons/labels-zh.json（原始素材已移出 public/，
 * 见 docs/优化清单-已完成与待办.md）和 lib/engagement.ts 两处，容易漂移。
 * 和 lib/engagement.ts 两处，容易漂移。现在收敛到这一份 TS 常量，
 * engagement.ts 与所有狐狸组件都从这里读。
 */
import type { IconStateKey } from './app-icon'

/** 每档表情的台词（短句化，≤8 字） */
export const FOX_LABELS: Record<IconStateKey, string> = {
  default: '我在这儿等你',
  streak_1: '继续加油！',
  streak_3: '势头不错！',
  streak_7: '干得漂亮！',
  streak_14: '燃起来了！',
  away_2: '别忘了回来呀',
  away_5: '你可以的',
  away_8: '就差一点…',
  away_12: '早点回来…',
  away_15: '别放弃！',
  away_20: '想你了…',
  away_25: '快点回来！',
  away_30: '最后机会！',
}

/** 表情「开心程度」-4 ~ +4，用于给内联位选调性 / 渐变色 */
export const FOX_CHEER: Record<IconStateKey, number> = {
  default: 0,
  streak_1: 1,
  streak_3: 2,
  streak_7: 3,
  streak_14: 4,
  away_2: -1,
  away_5: -1.5,
  away_8: -2,
  away_12: -2.5,
  away_15: -3,
  away_20: -3.5,
  away_25: -3.8,
  away_30: -4,
}

/** 连击里程碑（达成时放庆祝层级） */
export const FOX_MILESTONES: { day: number; key: IconStateKey }[] = [
  { day: 3, key: 'streak_3' },
  { day: 7, key: 'streak_7' },
  { day: 30, key: 'streak_14' },
]

/**
 * 档位梯度：从最失落到最兴奋，用于「图鉴」排序与进度条
 * （返回值不含 default）
 */
export const FOX_LADDER: IconStateKey[] = [
  'away_30',
  'away_25',
  'away_20',
  'away_15',
  'away_12',
  'away_8',
  'away_5',
  'away_2',
  'streak_1',
  'streak_3',
  'streak_7',
  'streak_14',
]

export function foxLabel(state: IconStateKey): string {
  return FOX_LABELS[state] || FOX_LABELS.default
}

export function foxCheer(state: IconStateKey): number {
  return FOX_CHEER[state] ?? 0
}

/** 连击 / 缺勤的一句话状态描述（去 AI 化：短句） */
export function foxStatusLine(opts: {
  state: IconStateKey
  streakCurrent: number
  awayDays: number
  checkedInToday: boolean
}): string {
  if (opts.checkedInToday || opts.awayDays === 0) {
    return `连续登录 ${Math.max(1, opts.streakCurrent)} 天`
  }
  return `已 ${opts.awayDays} 天没来`
}
