import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { savePhysicalTestResult } from '../lib/physical-test-results'
import { readPocketUni, savePocketUni } from '../lib/pocketuni-store'
import { puSummaryFromJson } from '../lib/pocketuni-parse'
import { refreshSchool } from '../store/school'

/** 手动录入通道：体测总分与 PU 总学分，直接写入本机缓存，断网也能看。 */
export function ManualScorePage() {
  const nav = useNavigate()
  const pu = readPocketUni()
  const [ticeScore, setTiceScore] = useState('')
  const [ticeYear, setTiceYear] = useState(() => {
    const now = new Date()
    const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
    return `${start}-${start + 1}`
  })
  const [puScore, setPuScore] = useState(pu?.totalCredit != null ? String(pu.totalCredit) : '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function submit() {
    setError(''); setMessage('')
    const tice = ticeScore.trim() ? Number(ticeScore) : null
    const puValue = puScore.trim() ? Number(puScore) : null
    if (tice !== null && (!Number.isFinite(tice) || tice < 0 || tice > 120)) { setError('体测总分请填 0–120。'); return }
    if (puValue !== null && (!Number.isFinite(puValue) || puValue < 0 || puValue > 60)) { setError('PU 学分请填 0–60。'); return }
    if (tice === null && puValue === null) { setError('至少填写一项。'); return }
    if (!/^\d{4}-\d{4}$/.test(ticeYear.trim())) { setError('学年格式示例：2025-2026'); return }
    try {
      if (tice !== null) {
        savePhysicalTestResult({ academicYear: ticeYear.trim(), testedAt: '', totalScore: tice, events: [], source: 'manual' })
      }
      if (puValue !== null) {
        const summary = puSummaryFromJson({ totalCredit: puValue, activityCredit: null, applyCredit: null, rows: [], year: 0, source: 'pocketuni', syncedAt: Date.now() })
        if (!summary) throw new Error('PU 数据格式不正确')
        savePocketUni(summary)
      }
      void refreshSchool()
      setMessage('已保存到本机，断网也能查看。')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败，请重试。')
    }
  }

  return <div style={{ minHeight: '100dvh', background: 'var(--bg-light, #faf7ef)' }}>
    <PageHeader title="手动录入成绩" />
    <div style={{ padding: '4px 16px 40px', display: 'grid', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2, #4b5e7a)' }}>学校系统读不到时，可以手动录入体测总分和 PU 学分；只保存在本机。</p>
      <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        体测总分（0–120）
        <input inputMode="decimal" value={ticeScore} onChange={(event) => setTiceScore(event.target.value)} placeholder="例如 70" style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line, #e3ebf7)', fontSize: 16 }} />
      </label>
      <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        体测学年
        <input value={ticeYear} onChange={(event) => setTiceYear(event.target.value)} placeholder="2025-2026" style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line, #e3ebf7)', fontSize: 16 }} />
      </label>
      <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        PU 总学分
        <input inputMode="decimal" value={puScore} onChange={(event) => setPuScore(event.target.value)} placeholder="例如 4.85" style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line, #e3ebf7)', fontSize: 16 }} />
      </label>
      {message ? <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--green-text, #12634e)' }}>{message}</p> : null}
      {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger, #b83b3b)' }}>{error}</p> : null}
      <button type="button" onClick={submit} style={{ minHeight: 48, borderRadius: 14, border: 0, background: 'var(--green, #16735b)', color: '#fff', fontSize: 16, fontWeight: 600 }}>保存到本机</button>
      <button type="button" onClick={() => nav('/grades')} style={{ minHeight: 44, borderRadius: 12, border: '1px solid var(--line, #e3ebf7)', background: 'transparent', fontSize: 14 }}>返回学业中心</button>
    </div>
  </div>
}
