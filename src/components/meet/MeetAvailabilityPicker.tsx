import { useId, useMemo, useState } from 'react'
import styles from './MeetAvailabilityPicker.module.css'

export type MeetAvailabilityPickerProps = {
  startsOn: string
  days: number
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
const halfHours = Array.from({ length: 28 }, (_, index) => {
  const start = 8 * 60 + index * 30
  return { start: clock(start), end: clock(start + 30) }
})

function dateOptions(startsOn: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn)
  if (!match || !Number.isInteger(days) || days < 1 || days > 7) return []
  const first = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  if (!Number.isFinite(first.getTime()) || dateKey(first) !== startsOn) return []
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first)
    date.setDate(first.getDate() + index)
    return {
      key: dateKey(date),
      label: `${date.getMonth() + 1}月${date.getDate()}日`,
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()],
    }
  })
}

export function MeetAvailabilityPicker({ startsOn, days, value, onChange, disabled = false }: MeetAvailabilityPickerProps) {
  const headingId = useId()
  const hintId = useId()
  const dates = useMemo(() => dateOptions(startsOn, days), [startsOn, days])
  const [chosenDay, setChosenDay] = useState(startsOn)
  const day = dates.find((item) => item.key === chosenDay) ?? dates[0]
  const allowed = useMemo(() => new Set(dates.flatMap((item) => halfHours.map((slot) => `${item.key}T${slot.start}`))), [dates])
  const selected = new Set(value.filter((slot) => allowed.has(slot)))
  const selectedMinutes = selected.size * 30
  const selectedLabel = selectedMinutes >= 60
    ? `${Math.floor(selectedMinutes / 60)} 小时${selectedMinutes % 60 ? ' 30 分钟' : ''}`
    : `${selectedMinutes} 分钟`
  const daySlots = day ? halfHours.map((slot) => `${day.key}T${slot.start}`) : []
  const daySelected = daySlots.filter((slot) => selected.has(slot)).length

  function updateDay(fill: boolean) {
    if (disabled || !day) return
    const next = new Set(selected)
    daySlots.forEach((slot) => fill ? next.add(slot) : next.delete(slot))
    onChange([...next].sort())
  }

  function toggle(slot: string) {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(slot)) next.delete(slot)
    else next.add(slot)
    onChange([...next].sort())
  }

  return <fieldset className={styles.picker} disabled={disabled} aria-labelledby={headingId} aria-describedby={hintId}>
    <legend className={styles.legend} id={headingId}>勾选你愿意参加的时间</legend>
    <div className={styles.summary}>
      <p id={hintId}>每格 30 分钟，可选多个时间段。</p>
      <span role="status" aria-live="polite">已选 <strong>{selectedLabel}</strong></span>
    </div>
    {!day ? <p className={styles.invalid}>活动日期暂不可用，请重新选择日期。</p> : <>
      <div className={styles.days} role="group" aria-label="选择可参加日期">
        {dates.map((item) => {
          const count = halfHours.filter((slot) => selected.has(`${item.key}T${slot.start}`)).length
          return <button key={item.key} type="button" className={styles.day} disabled={disabled}
            aria-pressed={day.key === item.key} aria-label={`${item.label}${item.weekday}，已选 ${count} 个时间格`}
            onClick={() => setChosenDay(item.key)}>
            <span>{item.weekday}</span><strong>{item.label}</strong>
            <small>{count ? `已选 ${count} 格` : '未选择'}</small>
          </button>
        })}
      </div>
      <div className={styles.dayHead}>
        <h3>{day.label} · {day.weekday}</h3>
        <div className={styles.dayActions}>
          <button type="button" disabled={disabled || daySelected === daySlots.length} onClick={() => updateDay(true)}>当天全选</button>
          <button type="button" disabled={disabled || daySelected === 0} onClick={() => updateDay(false)}>清空当天</button>
        </div>
      </div>
      <div className={styles.grid} role="group" aria-label={`${day.label}${day.weekday}的半小时空闲时间`}>
        {halfHours.map((slot) => {
          const key = `${day.key}T${slot.start}`
          return <button key={key} type="button" className={styles.slot} disabled={disabled} aria-pressed={selected.has(key)}
            aria-label={`${day.label} ${slot.start} 至 ${slot.end}`} onClick={() => toggle(key)}>
            <span>{slot.start}–{slot.end}</span>
          </button>
        })}
      </div>
      <p className={styles.note}>没课不一定有空，请按你实际愿意参加的时间选择。</p>
    </>}
  </fieldset>
}
