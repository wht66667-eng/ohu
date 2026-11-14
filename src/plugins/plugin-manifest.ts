/**
 * 哦狐内置插件契约。
 *
 * 插件实现必须由源码静态导入并随 Web / APK 一起构建；不支持远程脚本、eval、动态模块 URL。
 * manifest 是商城展示、入口路由和审核权限的唯一声明。
 */
export type OhuPluginPermission = 'schedule:open' | 'todo:open' | 'focus:open' | 'word-study:read' | 'word-study:write' | 'qbank:read' | 'local-bank:read' | 'local-bank:write'

export interface OhuPluginManifest {
  id: string
  version: string
  name: string
  category: '学习效率' | '校园生活' | '趣味探索'
  summary: string
  entryPath: string
  permissions: OhuPluginPermission[]
  bundled: true
  reviewed: true
  official: boolean
  defaultEnabled?: boolean
  author: string
  sourceName?: string
  sourceHref?: string
  sourceLicense?: string
}

export const BUILT_IN_PLUGINS: readonly OhuPluginManifest[] = [
  {
    id: 'study-focus-shortcut',
    version: '1.0.0',
    name: '专注计时',
    category: '学习效率',
    summary: '快速进入专注计时，开始一段学习时间。',
    entryPath: '/study/focus',
    permissions: ['focus:open'],
    bundled: true,
    reviewed: true,
    official: true,
    author: '哦狐',
  },
  {
    id: 'class-schedule-shortcut',
    version: '1.0.0',
    name: '课程提醒',
    category: '学习效率',
    summary: '快速打开课表与提醒设置；停用插件只隐藏此快捷入口，已安排的课程提醒仍按原设置运行。',
    entryPath: '/schedule',
    permissions: ['schedule:open'],
    bundled: true,
    reviewed: true,
    official: true,
    author: '哦狐',
  },
  {
    id: 'birthday-number-play', version: '1.0.0', name: '生日数字趣玩', category: '趣味探索',
    summary: '可先询问数字主题相关知识，再在本机生成反思提示；生日输入不会保存或上传。',
    entryPath: '/plugins/birthday-number-play', permissions: [], bundled: true, reviewed: true, official: false, author: 'wft',
    sourceName: 'fortune-org/fortune-platform（开源交互参考）', sourceHref: 'https://github.com/fortune-org/fortune-platform', sourceLicense: 'MIT；哦狐独立实现，未复制代码或素材',
  },
  {
    id: 'local-review-cards', version: '1.0.0', name: '今日记忆卡', category: '学习效率',
    summary: '直接复用哦狐单词计划和间隔复习记录，快速复习一张到期词卡。',
    entryPath: '/words', permissions: ['word-study:read', 'word-study:write'], bundled: true, reviewed: true, official: false, author: 'wft',
    sourceName: 'AnkiDroid（交互灵感参考）', sourceHref: 'https://github.com/ankidroid/Anki-Android', sourceLicense: 'GPL-3.0 项目；哦狐模块独立实现，未复制其代码、界面或素材',
  },
  {
    id: 'local-question-quick-quiz', version: '1.0.0', name: '题库五题快测', category: '学习效率',
    summary: '从哦狐本机题库随机抽取最多五题即时练习，不额外上传答案或创建试卷。',
    entryPath: '/english/bank', permissions: ['qbank:read'], bundled: true, reviewed: true, official: false, author: 'wft',
    sourceName: 'Exameow（题库练习流程参考）', sourceHref: 'https://github.com/heshengtao/exameow', sourceLicense: 'Apache-2.0（哦狐模块独立实现，未复制代码或题目素材）',
  },
  {
    id: 'fox-safety-library', version: '1.0.0', name: 'fox 安全知识', category: '学习效率',
    summary: '内置 1000 条安全知识记录，离线检索与查看参考答案；可导入自己的 JSON 题库。',
    entryPath: '/plugins/fox-safety', permissions: ['local-bank:read', 'local-bank:write'], bundled: true, reviewed: true, official: false, author: 'wft',
    sourceName: 'Scwizard/jiangsu-safety-competition（题库数据来源）', sourceHref: 'https://github.com/Scwizard/jiangsu-safety-competition/tree/4b797158c1886d5c457eaf33a4afd1a4a0218fbd',
    sourceLicense: 'Apache-2.0；保留 Scwizard 署名。插件界面独立实现，未接入平台自动作答或交卷。',
  },
  {
    id: 'appearance-workshop', version: '1.0.0', name: '外观工坊', category: '校园生活',
    summary: '切换皮肤、选择字体并调整服务页常用入口。布局保存在本机。',
    entryPath: '/settings?section=appearance', permissions: [], bundled: true, reviewed: true,
    official: true, defaultEnabled: false, author: '哦狐',
  },
] as const

export interface PluginLocalPreferences {
  enabled: string[]
  ratings: Record<string, number>
}

// New optional plugins start off; preserve every explicit prior choice.
const DEFAULT_ENABLED = BUILT_IN_PLUGINS.filter((plugin) => plugin.defaultEnabled ?? plugin.official).map((plugin) => plugin.id)
export const PLUGIN_PREFERENCES_EVENT = 'ohu-plugin-preferences-change'

export function pluginPreferencesKey(uid?: string | null): string {
  return `ohu.plugin-market.v1:${uid || 'guest'}`
}

export function readPluginPreferences(uid?: string | null): PluginLocalPreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pluginPreferencesKey(uid)) || 'null')
    if (!parsed || typeof parsed !== 'object') return { enabled: [...DEFAULT_ENABLED], ratings: {} }
    const value = parsed as Partial<PluginLocalPreferences>
    const knownIds = new Set(BUILT_IN_PLUGINS.map((plugin) => plugin.id))
    const enabled = Array.isArray(value.enabled)
      ? [...new Set(value.enabled.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
      : [...DEFAULT_ENABLED]
    const ratings: Record<string, number> = {}
    if (value.ratings && typeof value.ratings === 'object') {
      for (const [id, score] of Object.entries(value.ratings)) {
        if (knownIds.has(id) && Number.isInteger(score) && score >= 1 && score <= 5) ratings[id] = score
      }
    }
    return { enabled, ratings }
  } catch {
    return { enabled: [...DEFAULT_ENABLED], ratings: {} }
  }
}

export function writePluginPreferences(uid: string | null | undefined, preferences: PluginLocalPreferences): boolean {
  try {
    localStorage.setItem(pluginPreferencesKey(uid), JSON.stringify(preferences))
    window.dispatchEvent(new CustomEvent(PLUGIN_PREFERENCES_EVENT, { detail: uid || null }))
    return true
  } catch {
    return false
  }
}
