import { useEffect, useState, type ChangeEvent } from 'react'
import { PasswordInput } from './PasswordInput'
import {
  loadCampusAccount,
  saveCampusAccount,
  type CampusAccount,
} from '../lib/campus-account'
import {
  ALL_CAMPUS_LINKS,
  CAMPUS_LINKS,
  openCampusLink,
  type CampusLink,
} from '../lib/campus-links'
import {
  clearCampusOpens,
  listCampusOpens,
  warmCampusDb,
  type CampusOpenRow,
} from '../lib/campus-db'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { useAuth } from '../lib/auth'
import styles from './CampusAccountCard.module.css'

type Props = {
  onApplied?: (acc: CampusAccount) => void
  compact?: boolean
  linkScope?: 'campus' | 'all'
}

function credHint(cred: CampusLink['cred']): string {
  if (cred === 'vpn') return '复制 VPN 密码'
  if (cred === 'jw') return '复制教务密码'
  if (cred === 'cas') return '复制统一身份密码'
  return '直接打开'
}

function fmtAt(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

export function CampusAccountCard({ onApplied, compact, linkScope = 'campus' }: Props) {
  const auth = useAuth()
  const [session] = useState(captureQbankSession)
  const [acc, setAcc] = useState<CampusAccount>(() => loadCampusAccount())
  const [tip, setTip] = useState('')
  const [tipErr, setTipErr] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [opens, setOpens] = useState<CampusOpenRow[]>([])

  const links = linkScope === 'all' ? ALL_CAMPUS_LINKS : CAMPUS_LINKS

  async function refreshOpens() {
    try {
      const next = await listCampusOpens(12)
      if (isQbankSessionCurrent(session)) setOpens(next)
    } catch {
      if (isQbankSessionCurrent(session)) setOpens([])
    }
  }

  useEffect(() => {
    onApplied?.(acc)
    warmCampusDb()
    void refreshOpens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patch(p: Partial<CampusAccount>) {
    setAcc((a) => ({ ...a, ...p }))
  }

  function persist() {
    if (!isQbankSessionCurrent(session)) return
    if (!auth.isSigned) { auth.openLogin('保存学校账号前，请先用学号登录哦狐'); return }
    const next = {
      ...acc,
      vpnPassword: acc.vpnPassword || acc.jwPassword,
    }
    if (!saveCampusAccount(next, session)) {
      setTip('账号信息未能保存，请检查本机存储后重试')
      setTipErr(true)
      return
    }
    setAcc(next)
    onApplied?.(next)
    setTip(next.remember ? '已保存到当前哦狐账号，下次打开自动填好' : '已保存学号；本机不记住教务和 VPN 密码')
    setTipErr(false)
  }

  async function go(link: CampusLink) {
    if (!isQbankSessionCurrent(session)) return
    if (!auth.isSigned) { auth.openLogin('使用学校账号前，请先用学号登录哦狐'); return }
    setBusyId(link.id)
    const r = await openCampusLink(link, acc)
    if (!isQbankSessionCurrent(session)) return
    // Keep the current form draft when passwords were deliberately not remembered.
    if (r.saved) onApplied?.(acc)
    setTip(r.message)
    setTipErr(!r.ok)
    setBusyId(null)
    void refreshOpens()
  }

  async function onClearHistory() {
    if (!isQbankSessionCurrent(session)) return
    await clearCampusOpens()
    if (!isQbankSessionCurrent(session)) return
    setOpens([])
    setTip('已清空本机打开记录')
    setTipErr(false)
  }

  return (
    <div className={compact ? `${styles.card} ${styles.compact}` : styles.card}>
      <div className={styles.head}>
        <h3>校园账号 · 一键入口</h3>
        <p>
          信息按当前哦狐账号保存在本机；密码仅在勾选记住时保存。点入口会打开网址并记录本机打开历史（密码不入库）。
          学校网站无法由本 App 远程代点「登录」。
        </p>
      </div>

      <label className={styles.field}>
        <span>学号</span>
        <input
          className={styles.input}
          autoComplete="username"
          value={acc.stuid}
          onChange={(e) => patch({ stuid: e.target.value })}
          placeholder="例如 2023123456"
        />
      </label>
      <label className={styles.field}>
        <span>WebVPN / 统一身份密码</span>
        <PasswordInput
          className={styles.input}
          value={acc.vpnPassword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ vpnPassword: e.target.value })}
          placeholder="VPN / CAS 密码"
        />
      </label>
      <label className={styles.field}>
        <span>教务系统密码</span>
        <PasswordInput
          className={styles.input}
          value={acc.jwPassword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ jwPassword: e.target.value })}
          placeholder="正方教务密码（可与 VPN 相同）"
        />
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={acc.remember}
          onChange={(e) => patch({ remember: e.target.checked })}
        />
        记住以上信息（仅本机，卸载即清）
      </label>

      <div className={styles.actions}>
        <button type="button" className={styles.btnGhost} onClick={persist}>
          仅保存
        </button>
        <button type="button" className={styles.btnMain} disabled={!!busyId} onClick={() => void go(CAMPUS_LINKS[0])}>
          打开 VPN
        </button>
        <button
          type="button"
          className={styles.btnMain}
          disabled={!!busyId}
          onClick={() => void go(CAMPUS_LINKS.find((l) => l.id === 'jw')!)}
        >
          打开教务
        </button>
      </div>

      <div className={styles.linkBlock}>
        <h4>全部入口（一键保存并跳转）</h4>
        <ul className={styles.linkList}>
          {links.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={styles.linkRow}
                disabled={busyId === l.id}
                onClick={() => void go(l)}
              >
                <span className={styles.linkTag}>{l.tag}</span>
                <span className={styles.linkGrow}>
                  <b>{l.title}</b>
                  <span className={styles.linkUrl}>{l.href}</span>
                  <span>{l.desc}</span>
                </span>
                <span className={styles.linkGo}>
                  {busyId === l.id ? '…' : credHint(l.cred)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {linkScope === 'campus' ? (
          <p className={styles.moreHint}>考证官网可在「学业 → 校园入口」查看完整列表。</p>
        ) : null}
      </div>

      <div className={styles.linkBlock}>
        <h4>打开记录（本机库）</h4>
        {opens.length === 0 ? (
          <p className={styles.moreHint}>还没有记录。点上方任意入口后会出现在这里。</p>
        ) : (
          <ul className={styles.histList}>
            {opens.map((o) => (
              <li key={o.id} className={styles.histRow}>
                <span className={styles.linkTag}>{o.tag}</span>
                <span className={styles.histGrow}>
                  <b>{o.title}</b>
                  <span>
                    {fmtAt(o.at)}
                    {o.copied ? ' · 已复制密码' : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.histOpen}
                  onClick={() => {
                    const full = ALL_CAMPUS_LINKS.find((l) => l.id === o.linkId)
                    void go(
                      full || {
                        id: o.linkId,
                        title: o.title,
                        desc: '',
                        href: o.href,
                        tag: o.tag,
                        cred: 'none',
                        group: 'campus',
                      },
                    )
                  }}
                >
                  再开
                </button>
              </li>
            ))}
          </ul>
        )}
        {opens.length ? (
          <button
            type="button"
            className={styles.btnGhost}
            style={{ marginTop: 8 }}
            onClick={() => void onClearHistory()}
          >
            清空记录
          </button>
        ) : null}
      </div>

      {tip ? <p className={tipErr ? styles.err : styles.ok}>{tip}</p> : null}
    </div>
  )
}
