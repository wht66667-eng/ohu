/**
 * 登录后自动同步课表 / 成绩 / 考试 → 写入本机缓存并重排提醒。
 * 优先走服务端 OCR（/api/timetable/auto）；失败则返回 needCaptcha，由 UI 手输一次。
 */
import { saveExamsCache, saveGradesCache } from './academic-cache'
import { loadCampusAccount } from './campus-account'
import { isNotifyConsentGranted, refreshAllReminders } from './notify-setup'
import { loadScheduleCache, saveScheduleCache } from './schedule-cache'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import {
  autoQueryAcademic,
  fetchCaptcha,
  queryAcademic,
  type ExamRemote,
  type GradeRemote,
  type TimetableError,
  type TtRow,
} from './timetable'

export type AutoSyncResult = {
  ok: boolean
  needCaptcha: boolean
  /** 教务明确拒绝账号密码，应回表单改密码，不要停在验证码页 */
  passwordWrong: boolean
  message: string
  /** A reminder reconciliation warning kept separate from successful data sync. */
  reminderStatus?: string
  rows: TtRow[]
  grades: GradeRemote[]
  exams: ExamRemote[]
  captchaSid?: string
  captchaImage?: string
}

/** Prevent an older school request from replacing a newer snapshot in the same app session. */
export type AcademicSyncRun = {
  id: number
  session: ReturnType<typeof captureQbankSession>
}

let nextAcademicSyncRunId = 0
let latestAcademicSyncRun: AcademicSyncRun | null = null

export function beginAcademicSync(session = captureQbankSession()): AcademicSyncRun {
  const run = { id: ++nextAcademicSyncRunId, session }
  latestAcademicSyncRun = run
  return run
}

export function isAcademicSyncCurrent(run: AcademicSyncRun): boolean {
  return latestAcademicSyncRun === run && isQbankSessionCurrent(run.session)
}

type PersistResult = { saved: boolean; reminderStatus?: string }

async function persistAll(
  run: AcademicSyncRun,
  stuid: string,
  rows: TtRow[],
  grades: GradeRemote[],
  exams: ExamRemote[],
  errors: { grades_error?: string; exams_error?: string },
): Promise<PersistResult> {
  const { session } = run
  if (!isAcademicSyncCurrent(run)) return { saved: false }
  // A successful empty schedule must replace stale courses too. The cache marks
  // this as an explicit empty result so legacy/partial empty records stay invalid.
  if (!isAcademicSyncCurrent(run) || !saveScheduleCache(rows, stuid, session)) return { saved: false }
  if (!isAcademicSyncCurrent(run)) return { saved: false }
  if (!errors.grades_error && !saveGradesCache(grades, stuid, session)) return { saved: false }
  if (!isAcademicSyncCurrent(run)) return { saved: false }
  if (!errors.exams_error && !saveExamsCache(exams, stuid, session)) return { saved: false }
  if (!isAcademicSyncCurrent(run)) return { saved: false }
  if (isNotifyConsentGranted()) {
    // Reconcile every reminder category and retain failures/notices instead of
    // reporting academic sync success while silently leaving reminder plans stale.
    try {
      const result = await refreshAllReminders()
      if (!isAcademicSyncCurrent(run)) return { saved: false }
      const status = [...result.errors, ...result.notices]
      if (status.length) return { saved: true, reminderStatus: status.join('；') }
    } catch (error) {
      if (!isAcademicSyncCurrent(run)) return { saved: false }
      return { saved: true, reminderStatus: `提醒计划未能完整刷新：${(error as Error)?.message || '请在提醒设置中重试'}` }
    }
  } else {
    return { saved: true, reminderStatus: '哦狐通知授权尚未开启，本次同步没有刷新提醒计划' }
  }
  return { saved: true }
}

function isPasswordWrongErr(err: TimetableError): boolean {
  if (err.code === '1002') return true
  const m = err.message || ''
  return /密码不正确|密码错误|用户名或密码/.test(m)
}

function emptyFail(partial: Partial<AutoSyncResult> & { message: string }): AutoSyncResult {
  return {
    ok: false,
    needCaptcha: false,
    passwordWrong: false,
    rows: [],
    grades: [],
    exams: [],
    ...partial,
  }
}

export async function runAutoSync(opts?: {
  stuid?: string
  password?: string
  run?: AcademicSyncRun
}): Promise<AutoSyncResult> {
  const run = opts?.run ?? beginAcademicSync()
  const session = run.session
  if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '同步请求已更新，请在当前页面重试。' })
  if (!session.uid) return emptyFail({ message: '请先用学号登录哦狐，再同步教务数据。' })
  const acc = loadCampusAccount(session)
  const stuid = (opts?.stuid ?? acc.stuid).trim()
  /** 输入法常打出全角！？等，正方教务只认半角；NFKC 统一成 ASCII */
  const password = (opts?.password ?? acc.jwPassword).normalize('NFKC')
  if (!stuid || !password) {
    return emptyFail({ message: '缺少学号或教务密码' })
  }
  // Quiet background sync cannot claim another account's global credentials.
  // Explicit form submissions can establish a new snapshot after school login.
  if (!opts && loadScheduleCache().meta?.stuid?.trim().normalize('NFKC') !== stuid.normalize('NFKC')) {
    return emptyFail({ message: '请先在当前 App 账号下重新同步课表，再启用自动同步。' })
  }

  try {
    const data = await autoQueryAcademic({ username: stuid, password })
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '较早的同步结果已忽略，请使用最近一次同步结果。' })
    const persisted = await persistAll(run, stuid, data.rows, data.grades, data.exams, data)
    if (!persisted.saved) return emptyFail({ message: '教务数据已读取，但本机保存失败，可能只有部分内容已保存；请检查存储空间后重试。' })
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '较早的同步结果已忽略，请使用最近一次同步结果。' })
    const parts = [
      data.rows.length ? `课表 ${data.rows.length} 条` : '课表 0 条（已清除旧课程与提醒）',
      data.grades_error ? '成绩未同步，已保留当前账号缓存' : `成绩 ${data.grades.length} 门`,
      data.exams_error ? '考试未同步，已保留当前账号缓存' : `考试 ${data.exams.length} 场`,
    ].filter(Boolean)
    return {
      ok: true,
      needCaptcha: false,
      passwordWrong: false,
      message: `${data.grades_error || data.exams_error ? '已部分同步' : '已自动同步'}：${parts.join(' · ')}`,
      ...(persisted.reminderStatus ? { reminderStatus: persisted.reminderStatus } : {}),
      rows: data.rows,
      grades: data.grades,
      exams: data.exams,
    }
  } catch (e) {
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '账号或同步请求已更新，已停止较早请求。' })
    const err = e as TimetableError
    if (isPasswordWrongErr(err)) {
      return emptyFail({
        passwordWrong: true,
        message: '教务密码不正确。请核对正方教务密码后重试（不是 VPN 密码）。',
      })
    }
    /* OCR 未部署 / 识别失败 / 验证码类 → 手输验证码 */
    try {
      const cap = await fetchCaptcha()
      if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '账号或同步请求已更新，已停止较早请求。' })
      return emptyFail({
        needCaptcha: true,
        message: '请输入验证码完成同步（自动识别暂不可用或未成功）',
        captchaSid: cap.sid,
        captchaImage: cap.image,
      })
    } catch (ce) {
      if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '账号或同步请求已更新，已停止较早请求。' })
      return emptyFail({
        needCaptcha: true,
        message: (ce as Error).message || '请手输验证码',
      })
    }
  }
}

/** 手输验证码后提交同步 */
export async function runCaptchaSync(opts: {
  stuid: string
  password: string
  sid: string
  captcha: string
}): Promise<AutoSyncResult> {
  const run = beginAcademicSync()
  const session = run.session
  if (!session.uid) return emptyFail({ message: '请先用学号登录哦狐，再同步教务数据。' })
  try {
    const data = await queryAcademic(
      opts.sid,
      {
        username: opts.stuid.trim(),
        password: opts.password.normalize('NFKC'),
        captcha: opts.captcha.trim(),
      },
      ['schedule', 'grades', 'exams'],
    )
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '较早的同步结果已忽略，请使用最近一次同步结果。' })
    const persisted = await persistAll(run, opts.stuid.trim(), data.rows, data.grades, data.exams, data)
    if (!persisted.saved) return emptyFail({ message: '教务数据已读取，但本机保存失败，可能只有部分内容已保存；请检查存储空间后重试。' })
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '较早的同步结果已忽略，请使用最近一次同步结果。' })
    const parts = [
      data.rows.length ? `课表 ${data.rows.length} 条` : '课表 0 条（已清除旧课程与提醒）',
      data.grades_error ? '成绩未同步，已保留当前账号缓存' : `成绩 ${data.grades.length} 门`,
      data.exams_error ? '考试未同步，已保留当前账号缓存' : `考试 ${data.exams.length} 场`,
    ].filter(Boolean)
    return {
      ok: true,
      needCaptcha: false,
      passwordWrong: false,
      message: `${data.grades_error || data.exams_error ? '已部分同步' : '同步成功'}：${parts.join(' · ')}`,
      ...(persisted.reminderStatus ? { reminderStatus: persisted.reminderStatus } : {}),
      rows: data.rows,
      grades: data.grades,
      exams: data.exams,
    }
  } catch (e) {
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '账号或同步请求已更新，已停止较早请求。' })
    const err = e as TimetableError
    if (isPasswordWrongErr(err)) {
      return emptyFail({
        passwordWrong: true,
        message: '教务密码不正确。请返回修改密码后再同步。',
      })
    }
    let captchaSid: string | undefined
    let captchaImage: string | undefined
    if (err.code === '1001' || /验证码/.test(err.message || '')) {
      try {
        const cap = await fetchCaptcha()
        if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '账号或同步请求已更新，已停止较早请求。' })
        captchaSid = cap.sid
        captchaImage = cap.image
      } catch {
        /* ignore */
      }
    }
    if (!isAcademicSyncCurrent(run)) return emptyFail({ message: '账号或同步请求已更新，已停止较早请求。' })
    return emptyFail({
      needCaptcha: true,
      message: err.message || '同步失败',
      captchaSid,
      captchaImage,
    })
  }
}
