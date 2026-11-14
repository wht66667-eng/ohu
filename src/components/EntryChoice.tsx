import { useState } from 'react'
import { SCHOOLS, saveEntryTrack, saveSchoolProfile, type EntryTrack, type SchoolProfile } from '../lib/entry-track'
import styles from './EntryChoice.module.css'

/**
 * 首次启动的端别选择（M-ENTRY）：
 *  - 学生端：先选就读学校（当前仅江苏海洋大学开放教务链），再进学号认证门槛；
 *  - 社工端：校外用户走邮箱 / 手机验证码登录（SocialGate）。
 * 选择只存本机，可在「我的 → 切换身份」重选。
 */
export function EntryChoice({ onDone }: { onDone: (track: EntryTrack, school: SchoolProfile | null) => void }) {
  const [step, setStep] = useState<'track' | 'school'>('track')
  const [picked, setPicked] = useState<SchoolProfile | null>(null)

  const chooseTrack = (track: EntryTrack) => {
    if (track === 'student') { setStep('school'); return }
    saveEntryTrack('social')
    onDone('social', null)
  }

  const confirmSchool = (school: SchoolProfile) => {
    saveSchoolProfile(school)
    saveEntryTrack('student')
    onDone('student', school)
  }

  if (step === 'school') {
    return <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.eyebrow}>学生端 · 选择学校</span>
        <h1>你就读哪所学校？</h1>
        <p className={styles.hint}>教务同步链路按学校分别接入；未开放的学校会先进入通用版本。</p>
        <ul className={styles.schoolList}>
          {SCHOOLS.map(school => (
            <li key={school.id}>
              <button
                type="button"
                className={`${styles.schoolRow} ${picked?.id === school.id ? styles.picked : ''}`}
                disabled={!school.available}
                onClick={() => setPicked(school)}
              >
                <b>{school.name}</b>
                <small>{school.available ? '教务同步已接入' : '暂未开放'}</small>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={styles.primary}
          disabled={!picked}
          onClick={() => picked && confirmSchool(picked)}
        >
          进入学生端
        </button>
        <button type="button" className={styles.back} onClick={() => setStep('track')}>返回重选身份</button>
      </div>
    </div>
  }

  return <div className={styles.page}>
    <div className={styles.card}>
      <span className={styles.eyebrow}>OHU · 选择你的身份</span>
      <h1>你是哪类用户？</h1>
      <p className={styles.hint}>两边功能可以共用一台设备，选错也没关系，稍后可在「我的」里切换。</p>
      <div className={styles.tracks}>
        <button type="button" className={styles.trackCard} onClick={() => chooseTrack('student')}>
          <b>学生端</b>
          <small>在校学生：学号 + 校园网 + 统一认证，一键同步课表、成绩、考试，全程本机。</small>
          <span className={styles.tag}>推荐在校学生</span>
        </button>
        <button type="button" className={styles.trackCard} onClick={() => chooseTrack('social')}>
          <b>社工端</b>
          <small>校外用户：邮箱或手机验证码登录，无需学号；校园教务功能不开放。</small>
          <span className={styles.tag}>邮箱 / 手机验证码</span>
        </button>
      </div>
    </div>
  </div>
}
