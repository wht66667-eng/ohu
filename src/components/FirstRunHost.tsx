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
  requestNotifyPermission,
} from '../lib/notify-setup'
import styles from './FirstRunHost.module.css'

type Step = 'intro' | 'legal' | 'perms'

async function requestLocationOnce(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false
  return new Promise((resolve) => {
    const done = (ok: boolean) => resolve(ok)
    try {
      navigator.geolocation.getCurrentPosition(
        () => done(true),
        () => done(false),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
      )
    } catch {
      done(false)
    }
  })
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
        await requestNotifyPermission()
        if (permLines.some((p) => p.key === 'location')) {
          await requestLocationOnce()
        }
        // 相机一般在选用时由系统弹出；此处只做说明与标记
        if (!IS_NATIVE && permLines.some((p) => p.key === 'notify')) {
          /* H5 已在 requestNotifyPermission 处理 */
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
          <span className={styles.eyebrow}>{step === 'intro' ? '校园每一步，阿狐陪你' : meta.audience}</span>
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
              <div className={styles.foxScene}>{foxfree ? null : <img src={foxAssetUrl(slide.pose)} width="128" height="128" alt="阿狐校园伙伴" draggable={false} />}<span className={styles.campusLine} aria-hidden="true" /></div>
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
                {permLines.map((p) => (
                  <div key={p.key} className={styles.perm}>
                    <div>
                      <b>{p.title}</b>
                      <span>{p.desc}</span>
                    </div>
                  </div>
                ))}
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
                  {busy ? '请求中…' : '授权并进入'}
                </button>
              </div>
              <p className={styles.hint}>
                {IS_NATIVE ? '将弹出系统权限框；可逐项允许或拒绝。' : '浏览器将询问通知等权限；位置需在使用时确认。'}
              </p>
            </>
          )}
        </div>
      </div>
    </DialogLayer>
  )
}
