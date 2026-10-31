/**
 * 江苏海洋大学教务课表 HTML 解析
 * 真实结构（content_xs.aspx / 首页 iframe）：
 *   table#Table6 > tr > td「星期X」 + td.contp > p.kblsbk
 *     > span.time「3-4节 (1-10周)」
 *     > span.kejie「课程名」
 *     > span.didian「教室」
 */

export function parseZcd(text) {
  const src = String(text || '')
    .replace(/\s+/g, '')
    .replace(/(\d{1,2})-(\d{1,2})\|双周?/g, '$1-$2周(双)')
    .replace(/(\d{1,2})-(\d{1,2})\|单周?/g, '$1-$2周(单)')
    .replace(/(\d{1,2})\|双周?/g, '$1周(双)')
    .replace(/(\d{1,2})\|单周?/g, '$1周(单)')
  const out = new Set()
  const segs = String(src).match(/(\d{1,2})(?:-(\d{1,2}))?周?(?:[(（](单|双)[)）])?/g) || []
  if (!segs.length) {
    for (const m of String(src).match(/\d{1,2}/g) || []) out.add(Number(m))
    return [...out].sort((a, b) => a - b)
  }
  let parity = 0
  const modeGlobal = String(src).match(/[(（](单|双)[)）]/)
  if (modeGlobal) parity = modeGlobal[1] === '单' ? 1 : 2
  for (const seg of segs) {
    const mm = /(\d{1,2})(?:-(\d{1,2}))?周?(?:[(（](单|双)[)）])?/.exec(seg)
    if (!mm) continue
    const a = Number(mm[1])
    const b = mm[2] ? Number(mm[2]) : a
    const p = mm[3] ? (mm[3] === '单' ? 1 : 2) : parity
    for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
      if (p && w % 2 !== (p === 1 ? 1 : 0)) continue
      out.add(w)
    }
  }
  return [...out].sort((x, y) => x - y).filter((w) => w >= 1 && w <= 25)
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** 优先：Table6 / kblsbk 结构化解析 */
export function walkTable6(html) {
  const src = String(html || '')
  if (!/Table6|kblsbk|class="time"/i.test(src)) return null

  const dayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 }
  const out = []

  // 按 <tr> 切行（首页周课表一行=一天）
  const rows = src.match(/<tr[\s\S]*?<\/tr>/gi) || []
  for (const row of rows) {
    const dayM = />\s*星期([一二三四五六日])\s*</.exec(row) || /星期([一二三四五六日])/.exec(stripTags(row))
    if (!dayM) continue
    const day = dayMap[dayM[1]]
    if (!day) continue

    // 每门课一个 p.kblsbk
    const blocks = row.match(/<p[^>]*class="[^"]*kblsbk[^"]*"[^>]*>[\s\S]*?<\/p>/gi) || []
    for (const block of blocks) {
      const time = /class="time"[^>]*>([\s\S]*?)<\/span>/i.exec(block)
      const name = /class="kejie"[^>]*>([\s\S]*?)<\/span>/i.exec(block)
      const room = /class="didian"[^>]*>([\s\S]*?)<\/span>/i.exec(block)
      const timeText = stripTags(time?.[1] || '')
      const courseName = stripTags(name?.[1] || '')
      const roomText = stripTags(room?.[1] || '')
      if (!courseName || !timeText) continue

      const secM =
        /(\d{1,2})\s*[-~—至]\s*(\d{1,2})\s*节\s*[（(]\s*([^）)]+?)\s*[）)]/.exec(timeText) ||
        /(\d{1,2})\s*节\s*[（(]\s*([^）)]+?)\s*[）)]/.exec(timeText)
      if (!secM) continue
      const s1 = Number(secM[1])
      const s2 = secM[2] && /^\d+$/.test(secM[2]) ? Number(secM[2]) : s1
      const weekRaw = secM[2] && /^\d+$/.test(secM[2]) ? secM[3] : secM[2]
      if (s1 < 1 || s1 > 12 || s2 < s1 || s2 > 12) continue
      const weeks = parseZcd(weekRaw)
      if (!weeks.length) continue
      const sections = []
      for (let s = s1; s <= s2; s++) sections.push(s)
      for (const week of weeks) {
        out.push({
          week,
          day,
          sections: [...sections],
          name: courseName,
          teacher: '',
          room: roomText,
        })
      }
    }
  }
  return out.length ? out : null
}

/** 兜底：纯文本行解析（OCR / innerText） */
export function walkJouDayRowSchedule(html) {
  const structured = walkTable6(html)
  if (structured?.length) return structured

  const plain = decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|td|th|span)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
  if (!/星期[一二三四五六日]/.test(plain) || !/\d{1,2}\s*(?:[-~—至]\s*\d{1,2}\s*)?节/.test(plain)) return null

  const dayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 }
  const parts = plain.split(/(?=星期[一二三四五六日])/)
  const out = []
  for (const part of parts) {
    const dm = /星期([一二三四五六日])/.exec(part)
    if (!dm) continue
    const day = dayMap[dm[1]]
    if (!day) continue
    const lines = part
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const secM =
        /(\d{1,2})\s*[-~—至]\s*(\d{1,2})\s*节\s*[（(]\s*([^）)]+?)\s*[）)]/.exec(lines[i]) ||
        /(\d{1,2})\s*节\s*[（(]\s*([^）)]+?)\s*[）)]/.exec(lines[i])
      if (!secM) continue
      const s1 = Number(secM[1])
      const s2 = secM[2] && /^\d+$/.test(secM[2]) ? Number(secM[2]) : s1
      const weekRaw = secM[2] && /^\d+$/.test(secM[2]) ? secM[3] : secM[2]
      if (s1 < 1 || s1 > 12 || s2 < s1 || s2 > 12) continue
      const weeks = parseZcd(weekRaw)
      if (!weeks.length) continue
      let name = lines[i].slice(secM.index + secM[0].length).trim()
      let room = ''
      let j = i + 1
      if (!name || /^\d{1,2}\s*(?:[-~节]|星期)/.test(name)) {
        name = ''
        while (j < lines.length) {
          const cand = lines[j]
          if (/(\d{1,2})\s*(?:[-~—至]\s*\d{1,2}\s*)?节/.test(cand) || /^星期/.test(cand)) break
          if (/^[A-Za-z]?[\u4e00-\u9fa5A-Za-z]*\d{2,4}$/.test(cand) || /(楼|馆|室|文思|文通|苍梧)/.test(cand)) {
            room = cand
            j++
            break
          }
          if (/[\u4e00-\u9fa5A-Za-z]{2,}/.test(cand) && cand.length <= 40) {
            name = cand
            j++
            if (j < lines.length) {
              const r2 = lines[j]
              if (/^[A-Za-z]?[\u4e00-\u9fa5A-Za-z]*\d{2,4}$/.test(r2) || /(楼|馆|室|文思|文通|苍梧)/.test(r2)) {
                room = r2
                j++
              }
            }
            break
          }
          j++
        }
      } else {
        // 同行：课名 + 教室
        const rm = /\s+([A-Za-z]?[\u4e00-\u9fa5A-Za-z]*\d{2,4})\s*$/.exec(name)
        if (rm) {
          room = rm[1]
          name = name.slice(0, rm.index).trim()
        }
      }
      if (!name) continue
      const sections = []
      for (let s = s1; s <= s2; s++) sections.push(s)
      for (const week of weeks) {
        out.push({ week, day, sections, name, teacher: '', room: room || '' })
      }
    }
  }
  return out.length ? out : null
}

export function guessTerm(html = '') {
  const m = /第?\s*(20\d{2})\s*[-–—]\s*(20\d{2})\s*[-–—]?\s*([12])\s*学期/.exec(html)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const now = new Date()
  const y = now.getFullYear()
  const mo = now.getMonth() + 1
  if (mo >= 2 && mo <= 7) return `${y - 1}-${y}-2`
  return `${y}-${y + 1}-1`
}

function compressWeekNumbers(weeks) {
  if (!weeks.length) return '1-16'
  const parts = []
  let a = weeks[0]
  let b = weeks[0]
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === b + 1) b = weeks[i]
    else {
      parts.push(a === b ? String(a) : `${a}-${b}`)
      a = b = weeks[i]
    }
  }
  parts.push(a === b ? String(a) : `${a}-${b}`)
  return parts.join('、')
}

function newId(prefix = 'c') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

const COLORS = ['#FF5A1F', '#1AAE6F', '#3B82F6', '#A855F7', '#EAB308', '#EC4899', '#14B8A6', '#F97316']

export function rowsToTable(rows, term) {
  const bag = new Map()
  for (const r of rows || []) {
    if (!r?.name || !r.sections?.length) continue
    const start = r.sections[0]
    const end = r.sections[r.sections.length - 1]
    const key = `${r.name}|${r.day}|${start}|${end}|${r.room || ''}`
    let a = bag.get(key)
    if (!a) {
      a = {
        weeks: new Set(),
        teacher: r.teacher || '',
        room: r.room || '',
        start,
        end,
        day: r.day,
        name: r.name,
      }
      bag.set(key, a)
    }
    a.weeks.add(r.week)
    if (!a.teacher && r.teacher) a.teacher = r.teacher
  }
  const colorMap = new Map()
  let ci = 0
  const courses = []
  for (const a of bag.values()) {
    const weeks = [...a.weeks].sort((x, y) => x - y)
    const weeksStr = compressWeekNumbers(weeks)
    let color = colorMap.get(a.name)
    if (!color) {
      color = COLORS[ci % COLORS.length]
      colorMap.set(a.name, color)
      ci++
    }
    courses.push({
      id: newId(),
      name: a.name,
      teacher: a.teacher,
      room: a.room,
      day: a.day,
      startSection: a.start,
      endSection: a.end,
      weeks: weeksStr,
      parity: /双/.test(weeksStr) ? 2 : /单/.test(weeksStr) ? 1 : 0,
      color,
    })
  }
  return {
    id: newId('t'),
    name: '我的课表',
    term: term || '本学期',
    startDate: '2026-08-31',
    maxWeek: 20,
    courses,
    updatedAt: new Date().toISOString(),
    source: 'script',
  }
}

export function toWakeUpCsv(table) {
  const lines = ['课程名称,星期,开始节数,结束节数,老师,地点,周数']
  for (const c of table.courses || []) {
    const cells = [c.name, c.day, c.startSection, c.endSection, c.teacher || '', c.room || '', c.weeks].map((v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    lines.push(cells.join(','))
  }
  return lines.join('\n') + '\n'
}
