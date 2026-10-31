/** 番茄专注：用户提前配置的权限偏好（本地） */

const KEY = 'petdex.focusPrefs.v1'

export interface FocusPrefs {
  /** 屏蔽站内消息 / Tab / Toast（应用内，无需系统权限） */
  muteApp: boolean
  /** 开启系统勿扰（屏蔽通知，视设置也可屏蔽来电） */
  blockSystem: boolean
  /** 屏幕固定（系统「屏幕固定」需先在安全设置里打开） */
  lockTask: boolean
  /** 计时中留在海洋场景看圆环消耗（默认 false = 全屏沉浸防分心） */
  oceanTimer: boolean
}

const DEFAULTS: FocusPrefs = {
  muteApp: true,
  blockSystem: false,
  lockTask: false,
  oceanTimer: true,
}

export function loadFocusPrefs(): FocusPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      muteApp: raw.muteApp !== false,
      blockSystem: !!raw.blockSystem,
      lockTask: !!raw.lockTask,
      oceanTimer: raw.oceanTimer !== false,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveFocusPrefs(p: FocusPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}
