import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DialogLayer } from './ui/DialogLayer'
import { copyText } from '../lib/campus-account'
import {
  commonFreeSlotsForDate, encodeScheduleShare, importLocalScheduleShare,
  MAX_SCHEDULE_SHARE_LENGTH, readLocalScheduleShares, removeLocalScheduleShare, renameLocalScheduleShare,
  type SharedSchedule, type ShareVisibility,
} from '../lib/schedule-group'
import type { TtRow } from '../lib/timetable'
import type { PeriodPair } from '../lib/schedule-prefs'
import { getScheduleRowsForDate } from '../lib/schedule-cache'
import { toDateKey } from '../lib/schedule-calendar'
import styles from './ScheduleGroupSheet.module.css'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试。'

export function ScheduleGroupSheet({ rows, termStart, periods, ownerUid, onClose }: {
  rows: TtRow[]
  termStart: string
  periods: PeriodPair[]
  ownerUid: string
  onClose: () => void
}) {
  const [shares, setShares] = useState<SharedSchedule[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [name, setName] = useState('我的课表')
  const [visibility, setVisibility] = useState<ShareVisibility>('busy')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')

  useEffect(() => {
    try {
      setShares(readLocalScheduleShares(ownerUid))
      setError('')
    } catch (failure) { setError(messageOf(failure)) }
  }, [ownerUid])

  const selectedSchedules = useMemo(() => shares.filter(item => selected.includes(item.id)), [shares, selected])
  const localDateRows = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? getScheduleRowsForDate(new Date(date + 'T12:00:00'), rows, termStart)
    : [], [date, rows, termStart])
  const common = useMemo(() => {
    if (!selectedSchedules.length) return { slots: [], error: '' }
    try {
      return { slots: commonFreeSlotsForDate({ date, ownRows: localDateRows, ownLastWeek: rows.reduce((last, row) => Math.max(last, Number(row.week)), 0), ownTermStart: termStart, otherSchedules: selectedSchedules, periods }), error: '' }
    } catch (failure) { return { slots: [], error: messageOf(failure) } }
  }, [date, localDateRows, periods, rows, selectedSchedules, termStart])

  function perform(operation: () => void) {
    setError('')
    setNotice('')
    try { operation() }
    catch (failure) { setError(messageOf(failure)) }
  }

  function generateText(event: FormEvent) {
    event.preventDefault()
    if (!confirmed || !rows.length) return
    perform(() => {
      setOutput(encodeScheduleShare({ defaultName: name, visibility, rows, termStart }))
      setNotice('课表文本已生成。复制后发给要一起看空档的同学。')
    })
  }

  function importText(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    perform(() => {
      const { items, active, duplicate } = importLocalScheduleShare(ownerUid, input.trim())
      setShares(items)
      setSelected(current => current.includes(active.id) ? current : [...current, active.id])
      setInput('')
      setNotice(duplicate ? '已选择之前导入的课表。' : '已导入「' + active.localName + '」，可以查看共同空档。')
    })
  }

  function saveName(id: string) {
    perform(() => {
      setShares(renameLocalScheduleShare(ownerUid, id, editName))
      setEditingId('')
      setNotice('本机名称已更新。')
    })
  }

  function remove(id: string) {
    perform(() => {
      setShares(removeLocalScheduleShare(ownerUid, id))
      setSelected(current => current.filter(item => item !== id))
      if (editingId === id) setEditingId('')
      setNotice('已移除这份本机课表。')
    })
  }

  async function copyOutput() {
    if (!output) return
    setError('')
    const copied = await copyText(output)
    setNotice(copied ? '课表文本已复制。' : '自动复制未成功，请长按下方文本手动复制。')
  }

  return <DialogLayer title="多人课表" className={styles.dialog} onClose={onClose}>
    <div className={styles.sheet}>
      <header className={styles.header}><h2>多人课表</h2><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <p className={styles.intro}>复制课表文本给同学，导入后就能一起查空档。导入的课表保存在这台设备上。</p>
      <form className={styles.form} onSubmit={generateText}>
        <h3>分享我的课表</h3>
        <label>分享名称<input maxLength={30} value={name} onChange={event => { setName(event.target.value); setConfirmed(false); setOutput('') }} placeholder="例如：小王的课表" /></label>
        <label>分享内容<select value={visibility} onChange={event => { setVisibility(event.target.value === 'full' ? 'full' : 'busy'); setConfirmed(false); setOutput('') }}><option value="busy">只分享忙闲时段</option><option value="full">分享课程名称、教室和教师</option></select></label>
        <p className={styles.privacy}>{visibility === 'busy' ? '文本包含你填写的名称、学期起始日期，以及上课周次、星期和节次。' : '文本还包含课程名称、教室和教师。接收人可以读取或转发这些信息。'}</p>
        <label className={styles.consent}><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setOutput('') }} /><span>我已确认分享范围。发出的文本副本无法由哦狐撤回。</span></label>
        {rows.length ? null : <p className={styles.hint}>当前课表没有课程。同步或导入自己的课表后即可生成文本。</p>}
        <button className={styles.primary} type="submit" disabled={!rows.length || !name.trim() || !confirmed}>生成课表文本</button>
        {output ? <div className={styles.shareText}>
          <label>已生成的课表文本<textarea aria-label="已生成的课表文本" value={output} readOnly rows={3} onFocus={event => event.target.select()} /></label>
          <button type="button" onClick={() => void copyOutput()}>复制课表文本</button>
        </div> : null}
      </form>
      <form className={styles.import} onSubmit={importText}>
        <h3>导入同学课表</h3>
        <label className={styles.shareText}>课表文本<textarea value={input} onChange={event => setInput(event.target.value)} maxLength={MAX_SCHEDULE_SHARE_LENGTH} placeholder="粘贴完整课表文本" rows={3} /></label>
        <button type="submit" disabled={!input.trim()}>导入课表</button>
      </form>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <section className={styles.list} aria-labelledby="shared-schedule-title">
        <div className={styles.sectionHead}><h3 id="shared-schedule-title">已导入的本机课表</h3></div>
        {shares.length ? shares.map(item => <article className={styles.item} key={item.id}>
          <label className={styles.pick}><input type="checkbox" checked={selected.includes(item.id)} aria-label={'选择' + item.localName + '计算共同空档'} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span><strong>{item.localName}</strong><small>{item.visibility === 'busy' ? '忙闲时段' : '完整课程'} · {item.rows.length} 条记录</small></span></label>
          {editingId === item.id ? <div className={styles.rename}><input maxLength={30} value={editName} onChange={event => setEditName(event.target.value)} aria-label="新课表名称" /><button type="button" onClick={() => saveName(item.id)} disabled={!editName.trim()}>保存</button><button type="button" onClick={() => setEditingId('')}>取消</button></div> : null}
          <div className={styles.itemActions}>{editingId !== item.id ? <button type="button" onClick={() => { setEditingId(item.id); setEditName(item.localName) }}>改名</button> : null}<button type="button" className={styles.remove} onClick={() => remove(item.id)}>移除</button></div>
        </article>) : <p className={styles.hint}>导入同学发来的课表后，就可以按日期查看共同空档。</p>}
      </section>

      <section className={styles.free} aria-labelledby="common-free-title">
        <div className={styles.sectionHead}><h3 id="common-free-title">{rows.length ? '共同空档' : '同学课表空档'}</h3><label>活动日期<input type="date" value={date} min={toDateKey(new Date())} onChange={(event) => setDate(event.target.value)} /></label></div>
        <p className={styles.hint}>{rows.length ? '按各份课表的学期起点计算。' : '本机还没有你的课表，结果只包含所选同学的空档。'} 同学的临时调课和假期未纳入，节次时间按本机设置换算。</p>
        {!selectedSchedules.length ? <p className={styles.hint}>勾选至少一位同学的课表后，这里会显示大家都没课的时间段。</p> : common.error ? <p className={styles.warning} role="alert">{common.error}</p> : common.slots.length ? <div className={styles.slots}>{common.slots.map((slot) => <div key={`${slot.day}-${slot.startSection}`}><strong>{DAYS[slot.day - 1]} · {date.slice(5)}</strong><span>{slot.sectionLabel}</span><small>{slot.timeLabel}</small></div>)}</div> : <p className={styles.hint}>这一天没有找到共同空档；可以换个日期，或手动协商时间。</p>}
      </section>

    </div>
  </DialogLayer>
}
