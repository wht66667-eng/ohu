import { useEffect, useMemo, useState } from 'react'
import styles from '../pages/work.module.css'
import { ConfirmSheet } from './ConfirmSheet'
import { DialogLayer } from './ui/DialogLayer'
import { ExpressQuickJump } from './ExpressQuickJump'
import quickStyles from './ExpressQuickJump.module.css'
import {
  EMPTY_EXPRESS_TARGET,
  extractTrackingNumber,
  identifyExpress,
  isAppInstalled,
  launchExpress,
  type ExpressTarget,
} from '../lib/express'

/**
 * 读取系统剪贴板文本。
 * 套壳内走 Web Clipboard API（Capacitor WebView 支持）；
 * 失败/无权限时返回空串，由用户手动输入。
 */
async function readClipboardText(): Promise<string> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      return await navigator.clipboard.readText()
    }
  } catch {
    /* iOS 会弹权限，用户拒绝或无权限落到这里 */
  }
  return ''
}

/**
 * 快递单号识别 + 跳转弹层。
 *
 * 流程：
 *  1. 用户输入/粘贴快递单号
 *  2. 实时识别平台（京东 / 菜鸟 / 通用）+ 原生预检测是否已装对应 App
 *  3. 按钮文案动态：「打开京东 App 查物流」/「用浏览器查物流」
 *  4. 点「跳转」→ 弹二次确认 → 确认后跳转（已装走 App Scheme，未装走 H5）
 *
 * 合规：跳转前必须确认；跳转后不读取、不抓取任何页面内容。
 */
export function ExpressTrackSheet({ onClose }: { onClose: () => void }) {
  const [no, setNo] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [appInstalled, setAppInstalled] = useState(false)
  const [probing, setProbing] = useState(false)
  const [clipboardHint, setClipboardHint] = useState<string>('')

  // 打开弹层时自动读剪贴板，提取单号并填入输入框
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const text = await readClipboardText()
      if (cancelled) return
      const extracted = extractTrackingNumber(text)
      if (extracted) {
        setNo(extracted)
        setClipboardHint(`已从剪贴板识别单号：${extracted}`)
      } else if (text.trim()) {
        setClipboardHint('剪贴板未识别到快递单号，请手动输入')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const target: ExpressTarget = useMemo(
    () => (no.trim() ? identifyExpress(no) : EMPTY_EXPRESS_TARGET),
    [no],
  )

  // 单号/平台变化时，套壳内异步探测 App 是否已安装；H5 下恒 false
  useEffect(() => {
    let cancelled = false
    if (!target.appScheme) {
      setAppInstalled(false)
      return undefined
    }
    setProbing(true)
    isAppInstalled(target)
      .then((ok) => {
        if (!cancelled) setAppInstalled(ok)
      })
      .finally(() => {
        if (!cancelled) setProbing(false)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  const canGo = !!no.trim() && !!target.h5Url
  const btnText = !canGo
    ? '跳转查看物流'
    : target.platform === 'wechat'
      ? appInstalled
        ? '打开微信查物流'
        : '用顺丰官网查物流'
      : target.platform === 'taobao'
        ? appInstalled
          ? '打开淘宝菜鸟查物流'
          : '用浏览器查物流'
        : appInstalled
          ? `打开${target.displayName.split('（')[0]} App 查物流`
          : '用浏览器查物流'

  async function doLaunch() {
    setConfirmOpen(false)
    await launchExpress(target)
  }

  return (
    <>
      <DialogLayer title="取件与查物流" onClose={onClose}>
          <div className={styles.handle} />
          <h2 className={quickStyles.heading}>取件与查物流</h2>
          <ExpressQuickJump />
          <details className={quickStyles.lookup}>
          <summary>按单号查物流</summary>
          <p className={styles.wdTip}>
            输入快递单号，前往平台查询物流。取件身份码请使用上方快捷入口。
          </p>

          <div className={styles.field}>
            <label htmlFor="express-no">快递单号</label>
            <input
              id="express-no"
              className={styles.input}
              maxLength={40}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="如 JD0039… / SF1234…"
              value={no}
              onChange={(e) => {
                setNo(e.target.value)
                setClipboardHint('')
              }}
            />
            {clipboardHint ? (
              <p
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: 'var(--ocean-deep, #0b7fc9)',
                  opacity: 0.85,
                }}
              >
                {clipboardHint}
              </p>
            ) : null}
          </div>

          {/* 识别结果 */}
          <div className={styles.field}>
            <label>识别结果</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 12,
                background: 'var(--sea-glass-blue, #eaf6ff)',
                color: 'var(--ocean-deep, #0b7fc9)',
                fontWeight: 650,
                fontSize: 14,
              }}
            >
              <span>{target.displayName}</span>
              {probing ? (
                <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.6 }}>· 检测 App…</span>
              ) : appInstalled ? (
                <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>· 已安装，可一键跳转</span>
              ) : target.note ? (
                <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>· {target.note}</span>
              ) : null}
            </div>
          </div>

          <div className={styles.btnRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnBlk} ${styles.btnN}`}
              onClick={onClose}
            >
              关闭
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnBlk} ${styles.btnP}`}
              disabled={!canGo}
              onClick={() => setConfirmOpen(true)}
            >
              {btnText}
            </button>
          </div>
          </details>
          <button type="button" className={`${styles.btn} ${styles.btnBlk} ${styles.btnN}`} style={{ width: '100%', marginTop: 12 }} onClick={onClose}>关闭快递窗口</button>
      </DialogLayer>

      {confirmOpen && target.h5Url ? (
        <ConfirmSheet
          title={`跳转到${target.displayName}？`}
          desc="即将打开官方页面查看物流信息。需登录对应账号，且收件手机号一致才能看到取件码。"
          confirmText={appInstalled ? '打开 App' : '继续跳转'}
          onConfirm={doLaunch}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}
    </>
  )
}
