import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SHELL_ONBOARDING, STUDENT_INTRO } from '../data/shell-onboarding'
import { getAppShell } from '../lib/app-shell'
import { bootSettled, whenBootSettled } from '../lib/boot'
import {
  hasAcceptedLegal,
  hasFinishedPerms,
  markLegalAccepted,
  markPermsFinished,
  needsStudentGuide,
  markStudentGuideFinished,
} from '../lib/first-run'
import { foxAssetUrl } from '../lib/fox-art'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import { useUiMotion } from '../lib/motion-pref'
import { fadeUp } from '../lib/animations'
import { DialogLayer } from './ui/DialogLayer'
import { IS_NATIVE } from '../lib/platform'
import {
  markNotifyConsentAsked,
  refreshAllReminders,
} from '../lib/notify-setup'
import { restoreKeepAliveIfWanted } from '../lib/keep-alive'
import {
  checkAllPermissions,
  requestAllPermissions,
  type PermissionRow,
  type PermissionStatus,
} from '../lib/permission-center'
import styles from './FirstRunHost.module.css'

type Step = 'intro' | 'legal' | 'perms'

const PERM_STATUS_TEXT: Record<PermissionStatus, string> = {
  granted: '已允许',
  denied: '已拒绝',
  prompt: '待开启',
  manual: '需在系统页打开',
  unsupported: '当前设备不支持',
}

const PERM_STATUS_COLOR: Record<PermissionStatus, string> = {
  granted: '#1f8f5f',
  denied: '#c2413a',
  prompt: 'var(--text-2)',
  manual: '#b26a00',
  unsupported: 'var(--text-2)',
}

/**
 * 首次学生安装：三页可跳过的产品介绍，然后保留原协议与权限流程。
 * 未完成前挡住门禁 / 工作台，避免用户未同意协议就进业务。
 */
export function FirstRunHost({ onDone }: { onDone?: () => void }) {
  const shell = getAppShell()
  const meta = SHELL_ONBOARDING[shell]
  const reduce = useUiMotion()
  const foxfree = isFoxFreeVariant(useUiVariant())
  const [introIndex, setIntroIndex] = useState(0)
  const [ready, setReady] = useState(() => bootSettled())
  const [step, setStep] = useState<Step>(() => needsStudentGuide(shell) ? 'intro' : hasAcceptedLegal(shell) ? 'perms' : 'legal')
  const [open, setOpen] = useState(() => !hasFinishedPerms(shell) || !hasAcceptedLegal(shell))
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [permRows, setPermRows] = useState<PermissionRow[]>([])

  useEffect(() => {
    if (step !== 'perms') return
    let cancelled = false
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void checkAllPermissions().then((rows) => { if (!cancelled) setPermRows(rows) })
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [step])

  useEffect(() => {
    if (ready) return
    void whenBootSettled().then(() => setReady(true))
  }, [ready])

  useEffect(() => {
    if (hasAcceptedLegal(shell) && hasFinishedPerms(shell)) {
      setOpen(false)
      onDone?.()
    }
  }, [shell, onDone])

  const stepIndex = step === 'legal' ? 0 : 1

  const permLines = useMemo(() => meta.perms, [meta.perms])

  if (!ready || !open) return null

  async function finishPerms(request: boolean) {
    if (busy) return
    setBusy(true)
    try {
      if (request) {
        /* 一次列出并依次申请：通知、精确闹钟、电池白名单、悬浮窗、相机、位置。 */
        const rows = await requestAllPermissions(setPermRows)
        markNotifyConsentAsked()
        if (rows.find((row) => row.key === 'notify')?.status === 'granted') {
          await restoreKeepAliveIfWanted().catch(() => undefined)
          await refreshAllReminders().catch(() => undefined)
        }
      } else {
        markNotifyConsentAsked()
      }
      markPermsFinished(shell)
      setOpen(false)
      onDone?.()
    } finally {
      setBusy(false)
    }
  }

  function acceptLegal() {
    if (!agreed) return
    markLegalAccepted(shell)
    setStep('perms')
  }

  function finishIntro() {
    markStudentGuideFinished(shell)
    setStep(hasAcceptedLegal(shell) ? 'perms' : 'legal')
  }
  const slide = STUDENT_INTRO[introIndex]

  return (
    <DialogLayer title="首次使用引导" onClose={() => {}} allowClose={false} className={styles.guideSurface}>
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.eyebrow}>{step === 'intro' ? (foxfree ? '哦狐 · 校园生活' : '校园每一步，阿狐陪你') : meta.audience}</span>
          <h1>{step === 'intro' ? '欢迎来到哦狐' : meta.title}</h1>
          <p>{step === 'intro' ? `${introIndex + 1} / ${STUDENT_INTRO.length} · 认识你的校园伙伴` : step === 'legal' ? '请先阅读免责声明与简要说明书' : '你可以选择现在授权，也可以稍后设置'}</p>
          {step !== 'intro' ? <div className={styles.steps} aria-hidden>
            <span className={`${styles.dot} ${stepIndex >= 0 ? styles.dotOn : ''}`} />
            <span className={`${styles.dot} ${stepIndex >= 1 ? styles.dotOn : ''}`} />
          </div> : null}
        </div>

        <div className={styles.body}>
          {step === 'intro' ? <AnimatePresence mode="wait" initial={false}>
            <motion.section key={introIndex} className={styles.intro} {...fadeUp(reduce)} aria-live="polite">
              {!foxfree ? <div className={styles.foxScene}><img src={foxAssetUrl(slide.pose)} width="128" height="128" alt="阿狐校园伙伴" draggable={false} /><span className={styles.campusLine} aria-hidden="true" /></div> : null}
              <h2>{slide.title}</h2>
              <p>{slide.desc}</p>
              <div className={styles.serviceChips}>{slide.services.map((name) => <span key={name}>{name}</span>)}</div>
              <div className={styles.introSteps} aria-label="介绍页">{STUDENT_INTRO.map((item, index) => <span key={item.title} aria-current={introIndex === index ? 'step' : undefined} />)}</div>
            </motion.section>
          </AnimatePresence> : step === 'legal' ? (
            <>
              <h2 className={styles.sectionTitle}>{meta.disclaimerTitle}</h2>
              <ol className={styles.list}>
                {meta.disclaimer.map((t) => (
                  <li key={t.slice(0, 24)}>{t}</li>
                ))}
              </ol>
              <h2 className={styles.sectionTitle}>{meta.manualTitle}</h2>
              <ul className={styles.list}>
                {meta.manual.map((t) => (
                  <li key={t.slice(0, 24)}>{t}</li>
                ))}
              </ul>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>我已阅读并同意免责声明、用户协议与隐私政策，理解本端适用范围与风险。</span>
              </label>
            </>
          ) : (
            <>
              <h2 className={styles.sectionTitle}>权限获取</h2>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                下列权限均可在系统设置中随时关闭。拒绝不影响浏览公开内容，但相关功能将不可用。
              </p>
              <div className={styles.permList}>
                {permLines.map((p) => {
                  const status = permRows.find((row) => row.key === p.key)?.status
                  return (
                    <div key={p.key} className={styles.perm}>
                      <div>
                        <b>{p.title}</b>
                        <span>{p.desc}</span>
                      </div>
                      <em style={{ color: status ? PERM_STATUS_COLOR[status] : 'var(--text-2)', fontStyle: 'normal', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {status ? PERM_STATUS_TEXT[status] : '检查中…'}
                      </em>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div className={styles.foot}>
          {step === 'intro' ? <>
            <div className={styles.row}>
              {introIndex > 0 ? <button type="button" className={styles.ghost} onClick={() => setIntroIndex((value) => value - 1)}>上一页</button> : null}
              <button type="button" className={styles.main} onClick={() => introIndex === STUDENT_INTRO.length - 1 ? finishIntro() : setIntroIndex((value) => value + 1)}>{introIndex === STUDENT_INTRO.length - 1 ? '开始使用' : '下一页'}</button>
            </div>
            <button type="button" className={styles.skip} onClick={finishIntro}>跳过介绍</button>
          </> : step === 'legal' ? (
            <>
              <button type="button" className={styles.main} disabled={!agreed} onClick={acceptLegal}>
                同意并继续
              </button>
              <p className={styles.hint}>不同意将无法使用本应用。完整协议见设置页或交付文档包。</p>
            </>
          ) : (
            <>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={busy}
                  onClick={() => void finishPerms(false)}
                >
                  暂不授权
                </button>
                <button
                  type="button"
                  className={styles.main}
                  disabled={busy}
                  onClick={() => void finishPerms(true)}
                >
                  {busy ? '正在逐项开启…' : '一键全部开启'}
                </button>
              </div>
              <p className={styles.hint}>
                {IS_NATIVE
                  ? '会先弹通知/相机/位置授权框，再跳到精确闹钟、电池优化、悬浮窗系统页；请在系统页打开开关后返回。没打开的项会标成「需在系统页打开」。'
                  : '浏览器会询问通知与位置权限；其余权限在系统设置中管理。'}
              </p>
            </>
          )}
        </div>
      </div>
    </DialogLayer>
  )
}
