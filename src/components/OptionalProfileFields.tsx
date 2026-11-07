import { useState } from 'react'
import { COLLEGE_OPTIONS, GRADES } from '../lib/college-group'
import styles from './optional-profile-fields.module.css'

export type OptionalProfileValue = { building: string; realName: string; studentId: string; grade: string; major: string; college: string }

function OptionalValue({ label, value, onChange, disabled, numeric = false, maxLength = 40, choices = [] }: {
  label: string; value: string; onChange: (value: string) => void; disabled: boolean; numeric?: boolean; maxLength?: number; choices?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const options = [...new Set([value, ...choices].filter(Boolean))]
  return <div className={styles.field}>
    <label><span>{label}（选填）</span><select className="field-input" disabled={disabled} value={editing ? '__custom__' : value} onChange={event => {
      const next = event.target.value
      setEditing(next === '__custom__')
      if (next !== '__custom__') onChange(next)
    }}><option value="">暂不填写</option>{options.map(option => <option key={option} value={option}>{option}</option>)}<option value="__custom__">{value ? '修改填写内容' : '自行填写'}</option></select></label>
    {editing ? <label><span>填写{label}</span><input className="field-input" disabled={disabled} value={value} maxLength={maxLength} inputMode={numeric ? 'numeric' : 'text'} onChange={event => onChange(numeric ? event.target.value.replace(/\D/g, '') : event.target.value)} /></label> : null}
  </div>
}

export function OptionalProfileFields({ value, onChange, disabled = false }: { value: OptionalProfileValue; onChange: (value: OptionalProfileValue) => void; disabled?: boolean }) {
  const change = (key: keyof OptionalProfileValue, next: string) => onChange({ ...value, [key]: next })
  return <details className={styles.root}>
    <summary>更多资料 <span>全部选填</span></summary>
    <div className={styles.fields}>
      <OptionalValue label="楼栋" value={value.building} onChange={next => change('building', next)} disabled={disabled} maxLength={20} choices={['校外']} />
      <OptionalValue label="姓名" value={value.realName} onChange={next => change('realName', next)} disabled={disabled} maxLength={20} />
      <OptionalValue label="学号" value={value.studentId} onChange={next => change('studentId', next)} disabled={disabled} numeric maxLength={20} />
      <label><span>年级（选填）</span><select className="field-input" disabled={disabled} value={value.grade} onChange={event => change('grade', event.target.value)}><option value="">暂不填写</option>{value.grade && !GRADES.some(grade => grade === value.grade) ? <option value={value.grade}>{value.grade}</option> : null}{GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label>
      <OptionalValue label="专业" value={value.major} onChange={next => change('major', next)} disabled={disabled} />
      <label><span>所属学院（选填）</span><select className="field-input" disabled={disabled} value={value.college} onChange={event => change('college', event.target.value)}><option value="">暂不填写</option>{value.college && !COLLEGE_OPTIONS.some(college => college.key === value.college) ? <option value={value.college}>{value.college}</option> : null}{COLLEGE_OPTIONS.map(college => <option key={college.key} value={college.key}>{college.name}</option>)}</select></label>
    </div>
  </details>
}
