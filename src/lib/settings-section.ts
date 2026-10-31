export type SettingsSection = 'overview' | 'appearance' | 'reminders' | 'account' | 'data' | 'about' | 'admin'
export const SETTINGS_SECTION_TITLES: Record<SettingsSection, string> = {
  overview: '设置', appearance: '外观与陪伴', reminders: '通知与提醒', account: '账号与安全',
  data: '数据与缓存', about: '哦狐科技', admin: '管理工作台',
}

/** URL selection does not grant a role or expose an unavailable setting. */
export function resolveSettingsSection(raw: string | null, access: { studentRemind: boolean; showAdminBlock: boolean; showData: boolean }): SettingsSection {
  if (raw === 'appearance' || raw === 'account' || raw === 'about') return raw
  if (raw === 'data' && access.showData) return raw
  if (raw === 'reminders' && access.studentRemind) return raw
  if (raw === 'admin' && access.showAdminBlock) return raw
  return 'overview'
}
