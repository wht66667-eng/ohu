/**
 * 社工端首页社交区块（TASK-A5 → TASK-A6 迁移）：
 * - SocialSharedScheduleSection：「来自同学的课表」卡——直读授权给我的 schedule_shares
 *   （RLS 限定），逐个 schedule_share_read 取 fields 与课表快照；按 fields 三档渲染
 *   （关闭的字段连占位都不留）、按天分组；撤销/解除后空态；每次挂载/刷新重拉，不落持久缓存。
 * - SocialSpaceCard：「双人空间」入口卡——点开面板显示所在有效空间（称呼+关系类型标签+
 *   相伴/相恋天数大字+对方脱敏 uid 收进展开行），支持解除/屏蔽（二次确认，服务端级联撤共享，
 *   前端同步清空本地数据）。
 * 服务端契约 docs/sql/social-invites-166.sql（●待部署）；RPC 未部署（42883）时给出部署前空态。
 * 数据一律走 RLS（social_uid = auth.uid()），组件自身不读 auth 上下文。
 */
import { useEffect, useState } from 'react'
import { listGrantsToMe, scheduleShareRead, socialInviteStatus, socialSpaceClose } from '../lib/social-invites'
import {
  companionDays,
  companionDayText,
  courseRowText,
  groupCoursesByDay,
  maskSocialUid,
  parseSharedSnapshot,
  RELATION_OPTIONS,
  shareFieldsText,
  type SharedCourseRow,
  type ShareFields,
  type SpaceView,
} from '../lib/social-invites-helpers'
import { ConfirmSheet } from './ConfirmSheet'
import styles from '../pages/SimpleHomePage.module.css'

interface SharedEntry {
  studentUid: string
  fields: ShareFields
  rows: SharedCourseRow[]
  hasSnapshot: boolean
  updatedAt: string
}

/** 「来自同学的课表」首页卡（社工 track 专属） */
export function SocialSharedScheduleSection() {
  const [entries, setEntries] = useState<SharedEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const grants = await listGrantsToMe()
      if (grants.error) {
        setEntries([])
        setError(grants.error)
        return
      }
      const list: SharedEntry[] = []
      for (const row of grants.rows) {
        const read = await scheduleShareRead(row.studentUid)
        if (!read.ok) continue
        const rows = parseSharedSnapshot(read.snapshot)
        list.push({
          studentUid: row.studentUid,
          fields: read.fields || row.fields,
          rows,
          hasSnapshot: !!read.snapshot && (Array.isArray(read.snapshot) ? (read.snapshot as unknown[]).length > 0 : rows.length > 0),
          updatedAt: read.updatedAt || row.updatedAt,
        })
      }
      setEntries(list)
    } catch (e) {
      setEntriesError(e, setEntries, setError)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <section className={styles.card} aria-labelledby="ohu-home-shared-schedule">
    <div className={styles.cardHead}>
      <span className={styles.cardIcon} aria-hidden="true">课</span>
      <b id="ohu-home-shared-schedule">来自同学的课表</b>
      <button
        type="button"
        onClick={() => void reload()}
        disabled={loading}
        style={{ border: 0, background: 'transparent', color: '#1f5b3a', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}
      >
        {loading ? '刷新中…' : '刷新'}
      </button>
    </div>
    {loading && !entries ? (
      <p className={styles.emptyText}>正在读取共享授权…</p>
    ) : error ? (
      <div style={{ display: 'grid', gap: 8 }}>
        <p role="alert" style={{ margin: 0, fontSize: 12, color: '#b3372f' }}>共享课表读取失败：{error}</p>
        <button
          type="button"
          onClick={() => void reload()}
          style={{ alignSelf: 'start', border: 'none', borderRadius: 999, padding: '7px 16px', background: '#eef6f0', color: '#1f5b3a', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          重试读取
        </button>
      </div>
    ) : entries && entries.length ? entries.map((entry) => (
      <div key={entry.studentUid} style={{ border: '1px solid #d8e4dc', borderRadius: 14, padding: '12px 14px', display: 'grid', gap: 8, background: '#fbfdfb' }}>
        <small style={{ color: '#5c6f64' }}>来自 {maskSocialUid(entry.studentUid)} 的课表 · 可见：{shareFieldsText(entry.fields)}</small>
        {entry.rows.length ? (
          groupCoursesByDay(entry.rows, entry.fields).map((group) => (
            <div key={group.day} style={{ display: 'grid', gap: 4 }}>
              <b style={{ fontSize: 13, color: '#1f5b3a' }}>{group.label}</b>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
                {group.rows.map((row, idx) => (
                  <li key={`${row.week}-${row.day}-${row.sections.join('.')}-${idx}`} style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {courseRowText(row, entry.fields)}
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : entry.hasSnapshot ? (
          <p className={styles.emptyText}>该同学本周暂无可见课程。</p>
        ) : (
          <p className={styles.emptyText}>该同学还没有可展示的课表数据。</p>
        )}
      </div>
    )) : (
      <p className={styles.emptyText}>同学尚未共享课表。对方授权后点「刷新」即可看到。</p>
    )}
  </section>
}

function setEntriesError(e: unknown, setEntries: (v: SharedEntry[]) => void, setError: (v: string) => void) {
  setEntries([])
  setError(e instanceof Error ? e.message : '共享课表读取失败')
}

/** 「双人空间」首页入口卡（社工 track 专属）：点开面板查看空间与解除/屏蔽 */
export function SocialSpaceCard() {
  const [spaces, setSpaces] = useState<SpaceView[] | null>(null)
  const [open, setOpen] = useState(false)
  const [closeTarget, setCloseTarget] = useState<{ space: SpaceView; mode: 'dissolve' | 'block' } | null>(null)
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeError, setCloseError] = useState('')

  useEffect(() => {
    let alive = true
    socialInviteStatus().then((status) => {
      if (!alive) return
      setSpaces(status.error ? [] : status.spaces)
    })
    return () => { alive = false }
  }, [])

  async function confirmClose() {
    if (!closeTarget) return
    setCloseBusy(true)
    setCloseError('')
    try {
      const res = await socialSpaceClose(closeTarget.space.id, closeTarget.mode)
      if (res.error) {
        setCloseError(res.error)
        return
      }
      // 解除/屏蔽成功：清掉本地空间与共享课表数据，不留旧快照残留；
      // 通知硬门（SocialGate 监听）：剩余空间为 0 时回到邀请码绑定页。
      const remaining = (spaces || []).filter((s) => s.id !== closeTarget.space.id).length
      setSpaces((prev) => (prev || []).filter((s) => s.id !== closeTarget.space.id))
      setOpen(false)
      try { window.dispatchEvent(new CustomEvent('ohhu-social-spaces-changed', { detail: { activeSpaces: remaining } })) } catch { /* 非浏览器环境忽略 */ }
    } finally {
      setCloseBusy(false)
      setCloseTarget(null)
    }
  }

  return <>
    <section className={styles.card} aria-labelledby="ohu-home-social-space">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">♥</span>
        <b id="ohu-home-social-space">双人空间</b>
      </div>
      {spaces === null ? (
        <p className={styles.emptyText}>正在读取空间状态…</p>
      ) : spaces.length ? (
        <p className={styles.emptyText}>{spaces.length} 个空间：{spaces.map((space) => space.relationLabel).join(' · ')}</p>
      ) : (
        <p className={styles.emptyText}>还没有双人空间：用学生发给你的邀请码完成绑定后建立。</p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ alignSelf: 'start', border: '1.5px solid #1f5b3a', borderRadius: 999, padding: '8px 16px', background: 'transparent', color: '#1f5b3a', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
        查看双人空间 ›
      </button>
    </section>
    {open ? (
      <div
        role="dialog"
        aria-label="双人空间"
        style={{
          position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,35,25,.38)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
        onClick={() => setOpen(false)}
      >
        <div
          style={{
            width: 'min(430px, 100%)', maxHeight: '76vh', overflowY: 'auto', boxSizing: 'border-box',
            background: '#ffffff', borderRadius: '18px 18px 0 0', padding: '16px 16px 22px', display: 'grid', gap: 12,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <b style={{ fontSize: 16 }}>双人空间（私密，不公开）</b>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ border: 0, background: 'transparent', color: '#5c6f64', font: 'inherit', fontSize: 13, cursor: 'pointer' }}
            >
              收起
            </button>
          </div>
          {spaces && spaces.length ? spaces.map((space) => {
            const typeLabel = RELATION_OPTIONS.find((opt) => opt.value === space.relation)?.label || '好友'
            return (
              <div key={space.id} style={{ border: '1px solid #d8e4dc', borderRadius: 14, padding: '12px 14px', display: 'grid', gap: 8, background: '#fbfdfb' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontSize: 17, color: '#1c2b22' }}>{space.relationLabel}</b>
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: '#e7f1ea', color: '#1f5b3a', fontSize: 11.5, fontWeight: 700 }}>
                    {typeLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#1c2b22', letterSpacing: '0.02em' }}>
                    {companionDayText(space.anniversaryAt)}
                  </span>
                  <small style={{ color: '#5c6f64' }}>
                    {space.relation === 'lover' ? '相恋天数' : '相伴天数'} · 纪念日 {space.anniversaryAt ? new Date(space.anniversaryAt).toLocaleDateString('zh-CN') : '待确认'}
                    {Number.isFinite(companionDays(space.anniversaryAt)) ? ` · 已过 ${companionDays(space.anniversaryAt)} 天` : ''}
                  </small>
                </div>
                <details style={{ fontSize: 12, color: '#5c6f64' }}>
                  <summary style={{ cursor: 'pointer' }}>对方信息</summary>
                  <span style={{ display: 'block', marginTop: 4 }}>对方用户：{maskSocialUid(space.partnerUid)}</span>
                </details>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={closeBusy}
                    onClick={() => setCloseTarget({ space, mode: 'dissolve' })}
                    style={{ border: 'none', borderRadius: 999, padding: '6px 12px', background: '#ffe0e6', color: '#b3372f', fontSize: 12, fontWeight: 600, cursor: closeBusy ? 'default' : 'pointer' }}
                  >
                    解除关系
                  </button>
                  <button
                    type="button"
                    disabled={closeBusy}
                    onClick={() => setCloseTarget({ space, mode: 'block' })}
                    style={{ border: 'none', borderRadius: 999, padding: '6px 12px', background: '#f1f2f4', color: '#4b5e7a', fontSize: 12, fontWeight: 600, cursor: closeBusy ? 'default' : 'pointer' }}
                  >
                    屏蔽
                  </button>
                </div>
              </div>
            )
          }) : (
            <p style={{ margin: 0, fontSize: 13, color: '#5c6f64' }}>还没有双人空间：用学生发给你的邀请码完成绑定后，这里会显示关系与相伴天数。</p>
          )}
          {closeError ? <p role="alert" style={{ margin: 0, fontSize: 12, color: '#b3372f' }}>{closeError}</p> : null}
        </div>
      </div>
    ) : null}
    {closeTarget ? (
      <ConfirmSheet
        title={closeTarget.mode === 'block' ? '屏蔽这个空间？' : '解除这个关系？'}
        desc="解除后双方不再互见，已授予的课表共享会立即撤销并清空共享课表数据。可重新获取邀请码后再建空间。"
        confirmText={closeTarget.mode === 'block' ? '屏蔽' : '解除'}
        danger
        onClose={() => { if (!closeBusy) setCloseTarget(null) }}
        onConfirm={() => void confirmClose()}
      />
    ) : null}
  </>
}
