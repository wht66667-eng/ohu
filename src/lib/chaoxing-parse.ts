/**
 * 学习通（超星 v8）课程解析 · 纯函数。
 *
 * 取数通道是「课程页文字」而不是 `getStudyCourse` 接口：该接口在实测账号上返回空，
 * 页面上有课才读得到课（见交接文档 §7）。复制的课程卡片通常是：
 * ```
 * 高等数学A(1)
 * 张老师 · 已学 32/64 课时
 * ```
 * 第一行当课程名，其余行当详情，与 Flutter 版 `ChaoxingSnapshot.fromRows` 一致。
 *
 * 纯模块：不 import 本地文件，方便 `node --test` 直接回归。
 */


export interface ChaoxingCourse {
  title: string
  detail: string
  courseId?: string
  classId?: string
  state?: 'active' | 'ended'
}


export interface ChaoxingCourses {
  courses: ChaoxingCourse[]
  /** 毫秒时间戳；0 表示未知。 */
  syncedAt: number
}

const UI_NOISE = new Set([
  '首页', '我的', '消息', '课程', '学习通', '发现', '返回', '搜索', '全部', '全部课程',
  '进行中', '已结束', '未开始', '编辑', '更多', '扫一扫', '登录', '注册', '设置',
])

function cleanTitle(value: string): string {
  const text = value.replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 80 ? text.slice(0, 80) : text
}

function cleanDetail(value: string): string {
  const text = value.replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 200 ? text.slice(0, 200) : text
}

/** 把一段课程页文字归一成课程列表：去空行、去重、限制长度。 */
export function parseChaoxingCourses(text: string): ChaoxingCourse[] {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!raw) return []

  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean)
  const cards = blocks.length > 1 ? blocks : raw.split('\n').map((line) => line.trim()).filter(Boolean)

  const courses: ChaoxingCourse[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    const lines = card.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length) continue
    /* 一行里可能用制表符分隔「课程名 / 教师 / 进度」，也按卡片处理。 */
    const cells = lines.length === 1 ? lines[0].split('\t').map((cell) => cell.trim()).filter(Boolean) : lines
    const title = cleanTitle(cells[0] ?? '')
    if (!title || UI_NOISE.has(title)) continue
    const detail = cleanDetail(cells.slice(1).join(' · '))
    const key = `${title}|${detail}`
    if (seen.has(key)) continue
    seen.add(key)
    courses.push({ title, detail })
    if (courses.length >= 200) break
  }
  return courses
}

/** 从课程列表 HTML 里按 courseid:clazzid:cpi 提取课程（chaoxing-mcp 同款）。 */
/** SSO 落页是超星门户，课程名/教师按块出现；首个「姓名」块不是课程。 */
const SSO_STOP = /^(AI\s*助教|AI TEACHING|AI出题|AI教案|AI学情|查看详情|资源名称|江苏海洋大学官网|联系我们|在线客服|帮助中心|后台管理|Copyright|苏ICP|苏公网|校内链接|校外链接|国家高等教育智慧平台|周活跃)/
const SSO_META = /^(省级|国家级|校级|进行中|已结束|未开始|更多|未分组|其它院系|商学院|计算机工程学院|电子工程学院|环境与化学工程学院|海洋食品与生物工程学院|艺术设计学院|药学院|机械工程学院|土木与港海工程学院|理学院|文法学院|外国语学院|体育学院|应用技术学院|创新创业学院|马克思主义学院|继续教育学院)/

/** SSO 落页是超星门户，课程名/教师按块出现；首个「姓名」块与工具/院系目录不是课程。 */
export function parseChaoxingSsoPage(text: string): ChaoxingCourse[] {
  const result: ChaoxingCourse[] = []
  for (const [index, course] of parseChaoxingCourses(text).entries()) {
    if (SSO_STOP.test(course.title)) break
    if (index === 0 && !course.detail && /^[\u4e00-\u9fa5]{2,4}$/.test(course.title)) continue
    if (SSO_META.test(course.title)) continue
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(course.title)) continue
    if (/^[\u4e00-\u9fa5]{2,10}(学院|系|部)$/.test(course.title)) continue
    result.push(course)
  }
  return result
}
/** 从课程列表 HTML 里按 courseid:clazzid:cpi 提取课程（chaoxing-mcp 同款）。 */
/** SSO 落页是超星门户，课程名/教师按块出现；首个「姓名」块不是课程。 */

/** 学习通「我的课程」HTML：li.w_couritem 带 cid/classid/cname/state，课程名与教师在内层。 */
export function parseChaoxingCourseListHtml(html: string): ChaoxingCourse[] {
  const text = String(html ?? '')
  const courses: ChaoxingCourse[] = []
  const seen = new Set<string>()
  const itemPattern = /<li[^>]*class="[^"]*w_couritem[^"]*"[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = itemPattern.exec(text))) {
    const tag = match[0]
    const nextItem = text.indexOf('w_couritem', match.index + tag.length)
    const segment = text.slice(match.index, nextItem > 0 ? nextItem : match.index + 5000)
    const name = segment.match(/class="course-name[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1]?.replace(/<[^>]+>/g, '').trim()
    if (!name) continue
    const teacher = segment.match(/class="line2 color3"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    const ended = /not-open-tip|本课程已结课/.test(segment.slice(0, 2500))
    const courseId = tag.match(/\bcid="(\d+)"/)?.[1] ?? ""
    const classId = tag.match(/\bclassid="(\d+)"/)?.[1] ?? ""
    const key = courseId && classId ? `${courseId}:${classId}` : `${name}|${teacher}`
    if (seen.has(key)) continue
    seen.add(key)
    courses.push({ title: cleanTitle(name), detail: cleanDetail([teacher, ended ? "已结束" : "进行中"].filter(Boolean).join(" · ")), courseId: courseId || undefined, classId: classId || undefined, state: ended ? "ended" : "active" })
    if (courses.length >= 200) break
  }
  return courses
}

export function parseChaoxingCourseHtml(html: string): ChaoxingCourse[] {
  const text = String(html ?? '')
  const courses: ChaoxingCourse[] = []
  const seen = new Set<string>()
  const pattern = /stucoursemiddle\?courseid=(\d+)&(?:amp;)?clazzid=(\d+)&(?:amp;)?cpi=(\d+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const key = `${match[1]}:${match[2]}:${match[3]}`
    if (seen.has(key)) continue
    seen.add(key)
    const segment = text.slice(match.index, match.index + 3000)
    const name = segment.match(/course-name[^>]*title="([^"]+)"/)?.[1]
      ?? segment.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1]
      ?? ''
    if (!name) continue
    const teacher = segment.match(/line2 color3[^>]*title="([^"]+)"/)?.[1] ?? ''
    courses.push({ title: cleanTitle(name), detail: cleanDetail(teacher) })
    if (courses.length >= 200) break
  }
  return courses
}

/** 按校历判断当前学期：有学期号的精确匹配，无学期号的只保留进行中课程。 */
function calendarTerm(date: Date): string {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  const start = month >= 8 ? year : year - 1
  return `${start}-${start + 1}-${month >= 8 || month === 1 ? 1 : 2}`
}

export function filterCurrentSemester(courses: ChaoxingCourse[], now = new Date()): ChaoxingCourse[] {
  const current = calendarTerm(now)
  const [startYear, endYear] = current.split('-')
  return courses.filter((course) => {
    const text = course.title
    const full = text.match(/(20\d{2})\s*[-–—]\s*(20\d{2})(?:\s*[-–—]\s*([12]))?/)
    if (full) {
      const yearKey = `${full[1]}-${full[2]}`
      if (full[3]) return `${yearKey}-${full[3]}` === current
      return yearKey === `${startYear}-${endYear}` && course.state !== 'ended' && !course.detail.includes('已结束')
    }
    const short = text.match(/(?:^|[^\d])(\d{2})\s*[-–—]\s*(\d{2})(?:[^\d]|$)/)
    if (short) return `${2000 + Number(short[1])}-${2000 + Number(short[2])}` === `${startYear}-${endYear}`
    const single = text.match(/(20\d{2})/)?.[1]
    if (single) return Number(single) >= Number(startYear) && Number(single) <= Number(endYear)
    return course.state !== 'ended' && !course.detail.includes('已结束')
  })
}
export function chaoxingFromJson(value: unknown): ChaoxingCourses | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.courses) || record.courses.length > 200) return null
  const courses: ChaoxingCourse[] = []
  for (const item of record.courses) {
    if (!item || typeof item !== 'object') return null
    const course = item as Record<string, unknown>
    if (typeof course.title !== 'string' || !course.title.trim() || course.title.length > 80) return null
    if (typeof course.detail !== 'string' || course.detail.length > 200) return null
    const optional: Pick<ChaoxingCourse, 'courseId' | 'classId' | 'state'> = {}
    if (typeof course.courseId === 'string' && /^\d{1,20}$/.test(course.courseId)) optional.courseId = course.courseId
    if (typeof course.classId === 'string' && /^\d{1,20}$/.test(course.classId)) optional.classId = course.classId
    if (course.state === 'active' || course.state === 'ended') optional.state = course.state
    courses.push({ title: course.title, detail: course.detail, ...optional })
  }
  return {
    courses,
    syncedAt: typeof record.syncedAt === 'number' && Number.isFinite(record.syncedAt) ? record.syncedAt : 0,
  }
}

export function chaoxingToJson(value: ChaoxingCourses): Record<string, unknown> {
  return { courses: value.courses, syncedAt: value.syncedAt }
}
