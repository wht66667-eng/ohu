import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { DialogLayer } from './ui/DialogLayer'
import {
  commonFreeSlotsForDate, importScheduleShare, listScheduleShares, publishScheduleShare,
  removeImportedSchedule, renameImportedSchedule, revokeScheduleShare,
  type SharedSchedule, type ShareVisibility,
} from '../lib/schedule-group'
import type { TtRow } from '../lib/timetable'
import type { PeriodPair } from '../lib/schedule-prefs'
import { getScheduleRowsForDate } from '../lib/schedule-cache'
import { toDateKey } from '../lib/schedule-calendar'
import styles from './ScheduleGroupSheet.module.css'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试。'

export function ScheduleGroupSheet({ rows, termStart, periods, onClose }: {
  rows: TtRow[]
  termStart: string
  periods: PeriodPair[]
  onClose: () => void
}) {
  const [shares, setShares] = useState<SharedSchedule[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [name, setName] = useState('我的课表')
  const [visibility, setVisibility] = useState<ShareVisibility>('busy')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [pendingRevokeId, setPendingRevokeId] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try { const next = await listScheduleShares(); setShares(next); setSelected((current) => current.filter((id) => next.some((item) => item.id === id))) }
    catch (failure) { setError(messageOf(failure)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const selectedSchedules = useMemo(() => shares.filter((item) => !item.mine && selected.includes(item.id)), [shares, selected])
  const localDateRows = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? getScheduleRowsForDate(new Date(`${date}T12:00:00`), rows, termStart)
    : [], [date, rows, termStart])
  const common = useMemo(() => {
    if (!selectedSchedules.length) return { slots: [], error: '' }
    try {
      return { slots: commonFreeSlotsForDate({ date, ownRows: localDateRows, ownTermStart: termStart, otherSchedules: selectedSchedules, periods }), error: '' }
    } catch (failure) { return { slots: [], error: messageOf(failure) } }
  }, [date, localDateRows, periods, selectedSchedules, termStart])

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!rows.length) { setError('当前课表没有课程，先同步课表再分享。'); return }
    if (!confirmed) { setError('请先确认分享范围和可见内容。'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await publishScheduleShare({ defaultName: name, visibility, rows, termStart })
      setShares((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setConfirmed(false)
      setNotice(`分享码已生成：${created.code}`)
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function importCode(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const added = await importScheduleShare(code)
      setShares((current) => [added, ...current.filter((item) => item.id !== added.id)])
      setSelected((current) => current.includes(added.id) ? current : [...current, added.id])
      setCode(''); setNotice(`已导入「${added.localName}」，可修改本机显示名称。`)
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function saveName(item: SharedSchedule) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await renameImportedSchedule(item.id, editName)
      setShares((current) => current.map((row) => row.id === item.id ? { ...row, localName: editName.trim() } : row))
      setEditingId(''); setEditName(''); setNotice('名称已更新，只影响你这里的显示。')
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function remove(item: SharedSchedule) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (item.mine) await revokeScheduleShare(item.id)
      else await removeImportedSchedule(item.id)
      setShares((current) => current.filter((row) => row.id !== item.id))
      setSelected((current) => current.filter((id) => id !== item.id))
      setPendingRevokeId('')
      setNotice(item.mine ? '分享码已撤销。' : '已从你的列表移除。')
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function copy(value: string) {
    setError(''); setNotice('')
    try { await navigator.clipboard.writeText(value); setNotice('分享码已复制。') }
    catch { setNotice(`复制受限，请长按分享码手动复制：${value}`) }
  }

  return <DialogLayer title="多人课表" className={styles.dialog} onClose={onClose} allowClose={!busy}>
    <div className={styles.sheet}>
      <header className={styles.header}><div><span>OHU · SCHEDULE TOGETHER</span><h2>多人课表</h2></div><button type="button" onClick={onClose} aria-label="关闭" disabled={busy}>×</button></header>
      <p className={styles.intro}>用分享码添加同学的课表，给每份导入课表起自己的名字，再按选定日期查看共同空档。双方都能控制是否分享和何时撤销。</p>
      <form className={styles.form} onSubmit={publish}>
        <h3>分享我的课表</h3>
        <label>分享名称<input maxLength={30} value={name} onChange={(event) => { setName(event.target.value); setConfirmed(false) }} placeholder="例如：小王的课表" /></label>
        <label>分享内容<select value={visibility} onChange={(event) => { setVisibility(event.target.value as ShareVisibility); setConfirmed(false) }}><option value="busy">只分享忙闲时段</option><option value="full">分享课程名称、教室和教师</option></select></label>
        <p className={styles.privacy}>{visibility === 'busy' ? '忙闲模式只发送上课周次、星期和节次；课程名、教室、教师会在发送前移除。' : '完整模式会把课程名称、教室和教师随课表发送给哦狐服务及持有分享码的人。请确认你愿意分享这些信息。'}</p>
        <label className={styles.consent}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我了解分享范围，可以随时撤销我生成的分享码。</span></label>
        <button className={styles.primary} type="submit" disabled={busy || !rows.length || !name.trim() || !confirmed}>{busy ? '处理中…' : '生成分享码'}</button>
      </form>
      <form className={styles.import} onSubmit={importCode}>
        <h3>导入同学课表</h3><div><input value={code} maxLength={32} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="输入分享码" aria-label="课表分享码" /><button type="submit" disabled={busy || code.trim().length < 6}>导入</button></div>
      </form>
      <section className={styles.list} aria-labelledby="shared-schedule-title">
        <div className={styles.sectionHead}><h3 id="shared-schedule-title">已添加的课表</h3><button type="button" onClick={() => void refresh()} disabled={loading || busy}>刷新</button></div>
        {loading ? <p className={styles.hint} role="status">正在读取课表列表…</p> : shares.length ? shares.map((item) => <article className={styles.item} key={item.id}>
          <label className={styles.pick}><input type="checkbox" checked={!item.mine && selected.includes(item.id)} disabled={item.mine || busy} aria-label={item.mine ? `${item.localName}，自己分享的课表` : `选择${item.localName}计算共同空档`} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><strong>{item.localName}</strong><small>{item.mine ? '我分享的 · 仅用于分享管理' : '同学分享的'} · {item.visibility === 'busy' ? `忙闲 · ${item.rows.length} 个时段` : `完整课程 · ${item.rows.length} 条记录`}</small></span></label>
          {item.mine ? <div className={styles.code}><code>{item.code}</code><button type="button" onClick={() => void copy(item.code)} disabled={busy}>复制</button></div> : null}
          {!item.mine && editingId === item.id ? <div className={styles.rename}><input maxLength={30} value={editName} onChange={(event) => setEditName(event.target.value)} aria-label="新课表名称" /><button type="button" onClick={() => void saveName(item)} disabled={busy || !editName.trim()}>保存</button><button type="button" onClick={() => setEditingId('')}>取消</button></div> : null}
          <div className={styles.itemActions}>{!item.mine && editingId !== item.id ? <button type="button" onClick={() => { setEditingId(item.id); setEditName(item.localName) }} disabled={busy}>改名</button> : null}{item.mine && pendingRevokeId === item.id ? <><span className={styles.revokePrompt}>撤销后分享码立即失效</span><button type="button" className={styles.remove} onClick={() => void remove(item)} disabled={busy}>确认撤销</button><button type="button" onClick={() => setPendingRevokeId('')}>保留</button></> : <button type="button" className={styles.remove} onClick={() => item.mine ? setPendingRevokeId(item.id) : void remove(item)} disabled={busy}>{item.mine ? '撤销分享' : '移除'}</button>}</div>
        </article>) : <p className={styles.hint}>还没有添加课表。你可以生成分享码，或导入同学发来的分享码。</p>}
      </section>
      <section className={styles.free} aria-labelledby="common-free-title">
        <div className={styles.sectionHead}><h3 id="common-free-title">共同空档</h3><label>活动日期<input type="date" value={date} min={toDateKey(new Date())} onChange={(event) => setDate(event.target.value)} /></label></div>
        <p className={styles.hint}>按实际日期分别换算你的课表和同学的教学周，支持学期起点不同。仅按固定节次计算；不含同学的临时调课／假期，也暂按你的节次时间表换算，结果请大家确认。</p>
        {!selectedSchedules.length ? <p className={styles.hint}>勾选至少一位同学的课表后，这里会显示大家都没课的时间段。</p> : common.error ? <p className={styles.warning} role="alert">{common.error}</p> : common.slots.length ? <div className={styles.slots}>{common.slots.map((slot) => <div key={`${slot.day}-${slot.startSection}`}><strong>{DAYS[slot.day - 1]} · {date.slice(5)}</strong><span>{slot.sectionLabel}</span><small>{slot.timeLabel}</small></div>)}</div> : <p className={styles.hint}>这一天没有找到共同空档；可以换个日期，或手动协商时间。</p>}
      </section>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </div>
  </DialogLayer>
}
