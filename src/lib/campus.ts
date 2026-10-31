/**
 * 校区口径：任务发布时必选，落库写进 `tasks.location` 前缀。
 *
 * 线上 `tasks` 表没有独立 campus 列（`partner_apps` 才有），所以校区按
 * 「校区 · 具体地点」的形式存在 location 里：列表的 📍 能直接展示，
 * 卡片也能用 campusOf() 解析出校区徽标。历史数据（只有地点、无校区）原样兼容。
 */
export const CAMPUSES = ['通灌校区', '苍梧校区', '宋跳校区'] as const

export type Campus = (typeof CAMPUSES)[number]

/** 校区与地点的分隔符（带空格，便于阅读与解析） */
export const CAMPUS_SEP = ' · '

export function isCampus(v: string): v is Campus {
  return (CAMPUSES as readonly string[]).includes(v)
}

/** 从 location 解析校区；历史数据没有校区时返回空串 */
export function campusOf(location: string): Campus | '' {
  const head = (location || '').split(CAMPUS_SEP)[0].trim()
  return isCampus(head) ? head : ''
}

/** 组合落库用的 location：`通灌校区 · 各校区驿站`；未填具体地点时只留校区 */
export function composeLocation(campus: Campus | '', place = ''): string {
  const p = place.trim()
  if (!campus) return p
  return p ? `${campus}${CAMPUS_SEP}${p}` : campus
}

/** 去掉校区前缀后的具体地点（无校区时原样返回） */
export function placeOf(location: string): string {
  const campus = campusOf(location)
  const raw = location || ''
  return campus ? raw.slice(campus.length + CAMPUS_SEP.length).trim() : raw.trim()
}
