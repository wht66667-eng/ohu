/** 本机数据清理：本地缓存、IndexedDB 与 Cache Storage，一次清空。 */
const KEEP_PREFIXES: string[] = []

function localStorageKeys(): string[] {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key) keys.push(key)
  }
  return keys
}

/** 清空哦狐在本机保存的所有数据（登录身份、课表、成绩、待办设置等）。 */
export async function clearLocalAppData(): Promise<void> {
  for (const key of localStorageKeys()) {
    if (KEEP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    try { localStorage.removeItem(key) } catch { /* 忽略不可写 */ }
  }
  try { sessionStorage.clear() } catch { /* 忽略 */ }
  try {
    const databases = await indexedDB.databases?.()
    for (const database of databases ?? []) {
      if (database.name) indexedDB.deleteDatabase(database.name)
    }
  } catch { /* 浏览器不支持枚举时跳过 */ }
  try {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    }
  } catch { /* 忽略 */ }
}

/** 清空后回到门禁页重新认证。 */
export async function clearLocalAppDataAndReload(): Promise<void> {
  await clearLocalAppData()
  window.setTimeout(() => window.location.reload(), 150)
}
