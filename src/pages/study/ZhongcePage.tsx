import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import {
  COLLEGES,
  MATERIAL_PACK,
  SCHOOL_FORMULA,
  SCHOOL_SOURCE,
  calcZhongceTotal,
  type CollegeZhongce,
} from '../../data/zhongce'
import {
  claimLegacyZhongce,
  hasRestorableLegacyZhongce,
  loadZhongceChecks,
  loadZhongceCollegeId,
  loadZhongceScores,
  saveZhongceChecks,
  saveZhongceCollegeId,
  saveZhongceScores,
} from '../../lib/zhongce-store'
import { captureQbankSession } from '../../lib/qbank'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { IS_NATIVE } from '../../lib/platform'
import styles from './ZhongcePage.module.css'

type Panel = 'bonus' | 'materials' | 'calc' | 'sources'

function openUrl(url: string) {
  window.open(url, '_blank', IS_NATIVE ? undefined : 'noopener,noreferrer')
}

export function ZhongcePage() {
  useQbankRevision()
  const session = captureQbankSession()
  return <ZhongcePageContent key={`${session.uid}:${session.revision}`} />
}

function ZhongcePageContent() {
  const [collegeId, setCollegeId] = useState(() => loadZhongceCollegeId())
  const [panel, setPanel] = useState<Panel>('bonus')
  const [checks, setChecks] = useState(() => loadZhongceChecks())
  const [scores, setScores] = useState(() => loadZhongceScores())
  const [canRestoreLegacy, setCanRestoreLegacy] = useState(hasRestorableLegacyZhongce)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('')
  const [q, setQ] = useState('')

  const college = useMemo(
    () => COLLEGES.find((c) => c.id === collegeId) || COLLEGES[0],
    [collegeId],
  )

  const filteredBonuses = useMemo(() => {
    const key = q.trim().toLowerCase()
    if (!key) return college.bonuses
    return college.bonuses.filter(
      (b) =>
        b.title.toLowerCase().includes(key) ||
        b.category.toLowerCase().includes(key) ||
        b.points.toLowerCase().includes(key),
    )
  }, [college, q])

  const categories = useMemo(() => {
    const set = new Set(filteredBonuses.map((b) => b.category))
    return [...set]
  }, [filteredBonuses])

  const total = useMemo(() => {
    return calcZhongceTotal({
      culture: parseFloat(scores.culture) || 0,
      honesty: parseFloat(scores.honesty) || 0,
      daily: parseFloat(scores.daily) || 0,
      expand: parseFloat(scores.expand) || 0,
    })
  }, [scores])

  const checkedCount = MATERIAL_PACK.filter((m) => checks[m.id]).length

  function selectCollege(c: CollegeZhongce) {
    setCollegeId(c.id)
    setRestoreMessage(saveZhongceCollegeId(c.id) ? '' : '本机保存失败，当前改动只在本次打开期间生效。')
  }

  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] }
    setChecks(next)
    setRestoreMessage(saveZhongceChecks(next) ? '' : '本机保存失败，当前改动只在本次打开期间生效。')
  }

  function patchScore(key: keyof typeof scores, v: string) {
    const next = { ...scores, [key]: v }
    setScores(next)
    setRestoreMessage(saveZhongceScores(next) ? '' : '本机保存失败，当前改动只在本次打开期间生效。')
  }

  function restoreLegacy() {
    if (!claimLegacyZhongce()) {
      setRestoreMessage('恢复没有完成，旧数据仍保留；请检查本机存储后重试。')
      return
    }
    setCollegeId(loadZhongceCollegeId())
    setChecks(loadZhongceChecks())
    setScores(loadZhongceScores())
    setCanRestoreLegacy(false)
    setConfirmRestore(false)
    setRestoreMessage('已将旧版学院、材料清单和估算输入恢复到当前账号的本机记录。')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="综测加分" />

      {canRestoreLegacy ? <section className={styles.restorePanel} aria-label="恢复旧版综测记录">
        <b>发现旧版本机记录</b>
        <p>旧版综测记录没有账号归属。确认属于你后，才会复制到当前账号；原记录会保留在这台设备上。</p>
        {confirmRestore ? <div className={styles.restoreActions}>
          <button type="button" onClick={restoreLegacy}>确认属于我，恢复记录</button>
          <button type="button" onClick={() => setConfirmRestore(false)}>暂不恢复</button>
        </div> : <button type="button" className={styles.restoreButton} onClick={() => setConfirmRestore(true)}>查看恢复选项</button>}
      </section> : null}
      {restoreMessage ? <p className={styles.restoreMessage} role="status">{restoreMessage}</p> : null}

      <div className={styles.hero}>
        <h2>综合测评材料包</h2>
        <p>
          按学院查看加分项与应交材料。校级公式：
          {SCHOOL_FORMULA.text}
        </p>
        <p>学院选择、材料勾选和估算输入按哦狐账号保存在本机，不会同步到其他设备；最终要求请以学院最新通知为准。</p>
        <button type="button" className={styles.linkBtn} onClick={() => openUrl(SCHOOL_SOURCE.url)}>
          打开校级办法原文 ›
        </button>
      </div>

      <label className={styles.collegePick}>
        <span>我的学院</span>
        <select
          value={college.id}
          onChange={(e) => {
            const c = COLLEGES.find((x) => x.id === e.target.value)
            if (c) selectCollege(c)
          }}
        >
          {COLLEGES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.mode === 'school_only' ? '（校级框架）' : '（有本院细则）'}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.badgeRow}>
        <span className={styles.badge} data-mode={college.mode}>
          {college.mode === 'has_detail' ? '已整理本院公开细则' : '暂按校级办法 + 本院入口'}
        </span>
        <span className={styles.badgeMuted}>更新参考：{college.updated}</span>
      </div>

      {college.highlights.length ? (
        <ul className={styles.highlights}>
          {college.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.tabs}>
        {(
          [
            ['bonus', '加分项'],
            ['materials', `材料 ${checkedCount}/${MATERIAL_PACK.length}`],
            ['calc', '估算'],
            ['sources', '原文'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={panel === id ? `${styles.tab} ${styles.tabOn}` : styles.tab}
            onClick={() => setPanel(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {panel === 'bonus' ? (
        <section className={styles.sec}>
          <input
            className={styles.search}
            placeholder="搜加分项：四六级、竞赛、干部…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {categories.map((cat) => (
            <div key={cat} className={styles.catBlock}>
              <h3>{cat}</h3>
              <ul className={styles.bonusList}>
                {filteredBonuses
                  .filter((b) => b.category === cat)
                  .map((b) => (
                    <li key={b.id}>
                      <div className={styles.bonusHead}>
                        <b>{b.title}</b>
                        <em>{b.points}</em>
                      </div>
                      <div className={styles.mats}>
                        <span>建议材料</span>
                        {b.materials.map((m) => (
                          <i key={m}>{m}</i>
                        ))}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {!filteredBonuses.length ? <p className={styles.empty}>没有匹配的加分项</p> : null}
        </section>
      ) : null}

      {panel === 'materials' ? (
        <section className={styles.sec}>
          <p className={styles.hint}>勾选表示你已经准备好该材料（仅存本机，方便交表前自查）。</p>
          <ul className={styles.checkList}>
            {MATERIAL_PACK.map((m) => (
              <li key={m.id}>
                <label>
                  <input type="checkbox" checked={!!checks[m.id]} onChange={() => toggleCheck(m.id)} />
                  <span>
                    <b>{m.title}</b>
                    <i>{m.desc}</i>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {college.tips.length ? (
            <>
              <h3 className={styles.subH}>本院提醒</h3>
              <ul className={styles.tipList}>
                {college.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {panel === 'calc' ? (
        <section className={styles.sec}>
          <p className={styles.hint}>粗算工具：把四项分数填进去，看总分大概多少（非正式结果）。</p>
          <div className={styles.calcGrid}>
            {(
              [
                ['culture', '文化成绩均分', '60%'],
                ['honesty', '文明诚信分', '15%'],
                ['daily', '日常行为分', '10%'],
                ['expand', '素质拓展分', '15%'],
              ] as const
            ).map(([key, label, w]) => (
              <label key={key} className={styles.calcField}>
                <span>
                  {label} <small>{w}</small>
                </span>
                <input
                  inputMode="decimal"
                  value={scores[key]}
                  onChange={(e) => patchScore(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className={styles.totalCard}>
            <span>估算综测总分</span>
            <b>{total}</b>
          </div>
        </section>
      ) : null}

      {panel === 'sources' ? (
        <section className={styles.sec}>
          <ul className={styles.sourceList}>
            {college.sources.map((s) => (
              <li key={s.url + s.title}>
                <button type="button" className={styles.sourceRow} onClick={() => openUrl(s.url)}>
                  <b>{s.title}</b>
                  <span>{s.note || s.url}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.disclaimer}>
            本页为公开文件整理，便于同学备材料；分值冲突时一律以学院学工办最新通知与公示为准。
            电脑浏览器与手机 App / H5 共用同一套页面。
          </p>
        </section>
      ) : null}
    </div>
  )
}
