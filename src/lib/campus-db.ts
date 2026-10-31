/**
 * 校园入口专用数据库（IndexedDB）
 *
 * 库名：sunshine_campus_links
 * 表：
 *   links  — 全部官方入口目录（从 campus-links 种子同步）
 *   opens  — 每次一键打开的访问记录（不含密码）
 *
 * 密码仍只存在 campus-account 本机混淆存储，绝不写入本库 / 云库。
 * 登录后会尽力把 opens 同步到 CloudBase 表 campus_link_opens（表未建则静默跳过）。
 */
import { ALL_CAMPUS_LINKS, type CampusLink } from './campus-links'
import { cbAuth, cbRdb } from './cb'

const DB_NAME = 'sunshine_campus_links'
const DB_VER = 1
const STORE_LINKS = 'links'
const STORE_OPENS = 'opens'

export type CampusLinkRow = {
  id: string
  title: string
  desc: string
  href: string
  tag: string
  cred: CampusLink['cred']
  group: CampusLink['group']
  updatedAt: string
}

export type CampusOpenRow = {
  id: string
  linkId: string
  title: string
  href: string
  tag: string
  stuid: string
  copied: boolean
  at: string
}

type Any = any

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_LINKS)) {
        db.createObjectStore(STORE_LINKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_OPENS)) {
        const s = db.createObjectStore(STORE_OPENS, { keyPath: 'id' })
        s.createIndex('by_at', 'at', { unique: false })
        s.createIndex('by_link', 'linkId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('tx failed'))
    tx.onabort = () => reject(tx.error || new Error('tx aborted'))
  })
}

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 把注册表里的全部链接写入 links 表（幂等覆盖） */
export async function syncCampusLinkCatalog(): Promise<number> {
  const db = await openDb()
  const tx = db.transaction(STORE_LINKS, 'readwrite')
  const store = tx.objectStore(STORE_LINKS)
  const now = new Date().toISOString()
  for (const l of ALL_CAMPUS_LINKS) {
    const row: CampusLinkRow = {
      id: l.id,
      title: l.title,
      desc: l.desc,
      href: l.href,
      tag: l.tag,
      cred: l.cred,
      group: l.group,
      updatedAt: now,
    }
    store.put(row)
  }
  await txDone(tx)
  db.close()
  return ALL_CAMPUS_LINKS.length
}

export async function listCampusLinksDb(): Promise<CampusLinkRow[]> {
  await syncCampusLinkCatalog()
  const db = await openDb()
  const tx = db.transaction(STORE_LINKS, 'readonly')
  const store = tx.objectStore(STORE_LINKS)
  const rows = await new Promise<CampusLinkRow[]>((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve((req.result || []) as CampusLinkRow[])
    req.onerror = () => reject(req.error)
  })
  await txDone(tx)
  db.close()
  const order = new Map(ALL_CAMPUS_LINKS.map((l, i) => [l.id, i]))
  return rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
}

/** 记录一次打开（本机库必写；云端尽力同步） */
export async function recordCampusOpen(input: {
  link: CampusLink
  stuid?: string
  copied?: boolean
}): Promise<CampusOpenRow> {
  await syncCampusLinkCatalog()
  const row: CampusOpenRow = {
    id: uid(),
    linkId: input.link.id,
    title: input.link.title,
    href: input.link.href,
    tag: input.link.tag,
    stuid: (input.stuid || '').trim(),
    copied: !!input.copied,
    at: new Date().toISOString(),
  }
  const db = await openDb()
  const tx = db.transaction(STORE_OPENS, 'readwrite')
  tx.objectStore(STORE_OPENS).put(row)
  await txDone(tx)
  db.close()
  void pushOpenToCloud(row).catch(() => undefined)
  return row
}

export async function listCampusOpens(limit = 50): Promise<CampusOpenRow[]> {
  const db = await openDb()
  const tx = db.transaction(STORE_OPENS, 'readonly')
  const idx = tx.objectStore(STORE_OPENS).index('by_at')
  const rows = await new Promise<CampusOpenRow[]>((resolve, reject) => {
    const out: CampusOpenRow[] = []
    const req = idx.openCursor(null, 'prev')
    req.onsuccess = () => {
      const c = req.result
      if (!c || out.length >= limit) {
        resolve(out)
        return
      }
      out.push(c.value as CampusOpenRow)
      c.continue()
    }
    req.onerror = () => reject(req.error)
  })
  await txDone(tx)
  db.close()
  return rows
}

export async function clearCampusOpens(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_OPENS, 'readwrite')
  tx.objectStore(STORE_OPENS).clear()
  await txDone(tx)
  db.close()
}

async function currentUid(): Promise<string | null> {
  try {
    const u = (cbAuth() as Any).currentUser
    const id = u?.uid || u?.id || null
    return id ? String(id) : null
  } catch {
    return null
  }
}

async function pushOpenToCloud(row: CampusOpenRow): Promise<void> {
  const userId = await currentUid()
  if (!userId) return
  try {
    await (cbRdb().from('campus_link_opens') as Any).insert({
      uid: userId,
      link_id: row.linkId,
      title: row.title,
      href: row.href,
      tag: row.tag,
      stuid: row.stuid || null,
      copied: row.copied,
      opened_at: row.at,
    })
  } catch {
    /* 表未部署 / 未登录 / RLS：忽略 */
  }
}

/** 启动时预热目录 */
export function warmCampusDb() {
  void syncCampusLinkCatalog().catch(() => undefined)
}
