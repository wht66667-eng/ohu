import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { DialogLayer } from './ui/DialogLayer'
import { toast } from '../lib/toast'
import { localDateKey } from '../lib/chat-fortune'
import {
  addLifeRecord, updateLifeRecord, deleteLifeRecord, listLifeRecordsByDay,
  summarizeLifeRecords, clampWaterMl, parseAmountCents, formatCents,
  describeLifeRecord, formatRecordTime, defaultEdgeForPreset, LIFE_RECORDS_CHANGED_EVENT,
  MEAL_TYPES, EXPENSE_CATEGORIES, INCOME_CATEGORIES, WATER_PRESETS, PHOTO_PRESETS,
  type LifeRecord, type LifeRecordKind, type LifeRecordPhoto, type MealType, type MoneyDirection, type PhotoPreset,
} from '../lib/life-records'
import { buildLifePhoto, restyleLifePhoto } from '../lib/life-photo'
import { saveLocalSticker } from '../lib/local-stickers'
import { STICKER_EDGES, type StickerEdge } from '../lib/photo-sticker'
import { decodeBillText, parseBillCsv } from '../lib/bill-csv'
import {
  addBillDrafts, confirmBillDrafts, dismissBillDrafts, listBillDrafts, dayKeyOf,
  BILL_INBOX_CHANGED_EVENT, type BillDraft,
} from '../lib/bill-inbox'
import { recognizeBillImage, extractBillFromText } from '../lib/bill-ocr'
import styles from './QuickRecordSheet.module.css'

const KINDS: { value: LifeRecordKind; label: string }[] = [
  { value: 'water', label: '喝水' },
  { value: 'meal', label: '吃饭' },
  { value: 'expense', label: '消费' },
  { value: 'note', label: '一句话' },
]

export function QuickRecordSheet({ owner, onClose, initialKind }: { owner: string; onClose: () => void; initialKind?: LifeRecordKind }) {
  const [view, setView] = useState<'compose' | 'today' | 'inbox'>('compose')
  const [kind, setKind] = useState<LifeRecordKind>(initialKind ?? 'water')
  const [ml, setMl] = useState('250')
  const [mealType, setMealType] = useState<MealType>('lunch')
  const [mealName, setMealName] = useState('')
  const [direction, setDirection] = useState<MoneyDirection>('out')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0])
  const [expenseNote, setExpenseNote] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [photo, setPhoto] = useState<LifeRecordPhoto | null>(null)
  const [preset, setPreset] = useState<PhotoPreset>(initialKind === 'meal' ? 'meal' : 'cup')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoRequest = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<LifeRecord | null>(null)
  const [records, setRecords] = useState<LifeRecord[]>([])
  const [confirmingId, setConfirmingId] = useState('')
  // 账单草稿箱（M2.5·B1）：独立待确认层，确认后才进账本与汇总。
  const [drafts, setDrafts] = useState<BillDraft[] | null>(null)
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [inboxBusy, setInboxBusy] = useState(false)
  const billInput = useRef<HTMLInputElement>(null)
  const ocrInput = useRef<HTMLInputElement>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const categories = direction === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const today = localDateKey()
  const [day, setDay] = useState(today)
  const summary = summarizeLifeRecords(records)

  const refresh = useCallback(async () => {
    setRecords(await listLifeRecordsByDay(owner, day))
  }, [owner, day])

  useEffect(() => {
    refresh()
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ owner: string; day: string }>).detail
      if (detail?.owner === owner && detail?.day === day) refresh()
    }
    window.addEventListener(LIFE_RECORDS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(LIFE_RECORDS_CHANGED_EVENT, onChanged)
  }, [refresh, owner, day])

  const refreshDrafts = useCallback(async () => {
    try { setDrafts(await listBillDrafts(owner)) } catch { setDrafts([]) }
    setSelectedDrafts([])
  }, [owner])

  useEffect(() => {
    refreshDrafts()
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ owner: string }>).detail?.owner === owner) refreshDrafts()
    }
    window.addEventListener(BILL_INBOX_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(BILL_INBOX_CHANGED_EVENT, onChanged)
  }, [refreshDrafts, owner])

  useEffect(() => () => { photoRequest.current += 1 }, [owner])

  function switchDirection(next: MoneyDirection) {
    setDirection(next)
    setCategory((next === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0])
  }

  function resetForm() {
    setKind('water'); setMl('250'); setMealType('lunch'); setMealName('')
    setDirection('out'); setAmount(''); setCategory(EXPENSE_CATEGORIES[0])
    setExpenseNote(''); setNoteBody(''); setError('')
    setPhoto(null); setPreset('cup')
  }

  function startEdit(record: LifeRecord) {
    setEditing(record)
    setConfirmingId('')
    setError('')
    setKind(record.kind)
    setPhoto(record.photo ?? null)
    setPreset(record.photo?.preset ?? (record.kind === 'meal' ? 'meal' : 'cup'))
    if (record.kind === 'water') setMl(String(record.ml))
    else if (record.kind === 'meal') { setMealType(record.mealType); setMealName(record.name) }
    else if (record.kind === 'expense') {
      setDirection(record.direction); setCategory(record.category)
      setAmount(formatCents(record.amountCents)); setExpenseNote(record.note ?? '')
    } else setNoteBody(record.text)
    setView('compose')
  }

  function cancelEdit() {
    setEditing(null)
    resetForm()
  }

  async function remove(record: LifeRecord) {
    if (confirmingId !== record.id) { setConfirmingId(record.id); return }
    setConfirmingId('')
    await deleteLifeRecord(owner, record.id, record.day)
    toast.ok('已删除这条记录')
  }

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || photoBusy) return
    const request = ++photoRequest.current
    setPhotoBusy(true)
    try {
      const next = await buildLifePhoto(file, preset)
      if (request === photoRequest.current) setPhoto(next)
    } catch (reason) {
      if (request === photoRequest.current) toast.err(reason instanceof Error ? reason.message : '照片处理失败，可先保存文字记录。')
    } finally { if (request === photoRequest.current) setPhotoBusy(false) }
  }

  async function applyPreset(next: PhotoPreset) {
    if (photoBusy) return
    if (!photo) { setPreset(next); return }
    const request = ++photoRequest.current
    setPhotoBusy(true)
    try {
      const result = await restyleLifePhoto(photo, defaultEdgeForPreset(next), next)
      if (request === photoRequest.current) { setPhoto(result); setPreset(next) }
    } catch {
      if (request === photoRequest.current) toast.err('贴纸生成失败，可先保存文字记录。')
    } finally { if (request === photoRequest.current) setPhotoBusy(false) }
  }

  async function applyEdge(edge: StickerEdge) {
    if (!photo || photoBusy) return
    const request = ++photoRequest.current
    setPhotoBusy(true)
    try {
      const next = await restyleLifePhoto(photo, edge)
      if (request === photoRequest.current) setPhoto(next)
    } catch {
      if (request === photoRequest.current) toast.err('贴纸生成失败，可先保存文字记录。')
    } finally { if (request === photoRequest.current) setPhotoBusy(false) }
  }

  async function collectPhoto() {
    if (!photo || busy || photoBusy || collecting) return
    const request = photoRequest.current
    setCollecting(true)
    try {
      await saveLocalSticker(owner, photo)
      if (request === photoRequest.current) toast.ok('已收藏贴纸，可在照片编辑器中使用')
    } catch {
      if (request === photoRequest.current) toast.err('贴纸收藏失败，请检查本机存储后重试。')
    } finally { if (request === photoRequest.current) setCollecting(false) }
  }

  // 导入官方账单 CSV（微信／支付宝）：解析全部在本机完成，结果先进草稿箱等待确认。
  async function importBillCsv(file?: File) {
    if (!file || importing || busy || photoBusy || collecting || inboxBusy) return
    setImporting(true)
    setError('')
    try {
      const text = decodeBillText(await file.arrayBuffer())
      const bill = parseBillCsv(text)
      if (!bill) {
        toast.err('没有识别出微信或支付宝账单表头，请确认导出的是官方账单 CSV。')
        return
      }
      const result = await addBillDrafts(owner, bill.rows)
      toast.ok(result.added
        ? `已导入 ${result.added} 笔待确认${result.duplicates ? `，${result.duplicates} 笔重复跳过` : ''}。`
        : '账单里没有新增记录（可能都已确认或导入过）。')
      setView('inbox')
    } catch (reason) {
      toast.err(reason instanceof Error ? reason.message : '账单解析失败，请重试。')
    } finally { setImporting(false) }
  }

  async function confirmSelectedDrafts() {
    if (!selectedDrafts.length || inboxBusy || importing) return
    setInboxBusy(true)
    try {
      const result = await confirmBillDrafts(owner, selectedDrafts, 'csv')
      if (result.confirmed) toast.ok(`已确认 ${result.confirmed} 笔入账`)
      if (result.failed.length) toast.err(`${result.failed.length} 笔入账失败：${result.failed[0].reason}`)
      setSelectedDrafts([])
    } finally { setInboxBusy(false) }
  }

  async function dismissSelectedDrafts() {
    if (!selectedDrafts.length || inboxBusy || importing) return
    setInboxBusy(true)
    try {
      const removed = await dismissBillDrafts(owner, selectedDrafts)
      toast.ok(`已丢弃 ${removed} 笔草稿，不会写入账本`)
    } finally { setInboxBusy(false) }
  }

  // 截图 OCR（M2.5-B2）：本机识别 → 抽取 → 草稿箱；原文不落库，草稿需确认。
  async function recognizeShot(file?: File) {
    if (!file || ocrBusy || importing || inboxBusy) return
    setOcrBusy(true)
    try {
      const text = await recognizeBillImage(file)
      const row = extractBillFromText(text)
      if (!row) { toast.err('没有从截图里认出金额或收支方向，请手动记一笔或换张清晰截图。'); return }
      const result = await addBillDrafts(owner, [row])
      toast.ok(result.added ? '已从截图生成 1 笔待确认草稿，请在草稿箱核对。' : '截图与已有账单重复，没有新增草稿。')
      setView('inbox')
    } catch (reason) {
      toast.err(reason instanceof Error ? reason.message : '截图识别失败，请重试。')
    } finally { setOcrBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || photoBusy || collecting) return
    setError('')
    setBusy(true)
    try {
      let fields: Partial<LifeRecord> & { note?: string }
      if (kind === 'water') {
        const value = clampWaterMl(Number(ml))
        if (value === null) throw new Error('饮水量需为 1–10000 之间的整数毫升。')
        fields = { kind: 'water', ml: value, photo: photo ?? undefined }
      } else if (kind === 'meal') {
        fields = { kind: 'meal', mealType, name: mealName, photo: photo ?? undefined }
      } else if (kind === 'expense') {
        const cents = parseAmountCents(amount)
        if (cents === null) throw new Error('金额无效，请填写大于 0 的数字（最多两位小数）。')
        fields = { kind: 'expense', amountCents: cents, category, direction, note: expenseNote }
      } else {
        fields = { kind: 'note', text: noteBody }
      }
      if (editing) {
        await updateLifeRecord({ ...editing, ...fields } as LifeRecord)
        toast.ok('已更新这条记录')
        setEditing(null)
        resetForm()
        setView('today')
        setBusy(false)
      } else {
        await addLifeRecord({ owner, day, ...fields } as Parameters<typeof addLifeRecord>[0])
        if (kind === 'water') toast.ok(`已记录喝水 ${(fields as { ml: number }).ml} mL`)
        else if (kind === 'meal') toast.ok('已记录一餐')
        else if (kind === 'expense') toast.ok(`${direction === 'in' ? '已记录收入' : '已记录支出'} ¥${formatCents((fields as { amountCents: number }).amountCents)}`)
        else toast.ok('已记一句话')
        onClose()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '记录失败，请重试。')
      setBusy(false)
    }
  }

  return <DialogLayer title="记一笔" className={styles.sheet} onClose={onClose}>
    <div className={styles.head}>
      <h2>记一笔</h2>
      <p>只记在本机，按账号和日期保存，可随时修改或删除。</p>
    </div>
    <div className={styles.dayPick}>
      <label htmlFor="qr-day">日期</label>
      <input id="qr-day" type="date" value={day} max={today} disabled={busy || photoBusy || collecting || !!editing} onChange={event => { setDay(event.target.value || today); setConfirmingId('') }} />
    </div>
    <div className={styles.views} role="group" aria-label="记录视图">
      <button type="button" aria-pressed={view === 'compose'} disabled={busy || photoBusy || collecting} onClick={() => { setView('compose'); setConfirmingId('') }}>记一笔</button>
      <button type="button" aria-pressed={view === 'today'} disabled={busy || photoBusy || collecting} onClick={() => { setView('today'); setConfirmingId('') }}>{day === today ? '今天' : day}（{records.length}）</button>
      <button type="button" aria-pressed={view === 'inbox'} disabled={busy || photoBusy || collecting || importing} onClick={() => { setView('inbox'); setConfirmingId('') }}>草稿箱{drafts?.length ? `（${drafts.length}）` : ''}</button>
    </div>
    {view === 'inbox' ? <div className={styles.inbox}>
      <p className={styles.inboxNote}>账单草稿来自通知／截图／CSV 导入，<b>确认后才会记账</b>；丢弃不写任何记录，草稿保留 7 天。</p>
      <div className={styles.importRow}>
        <button type="button" disabled={ocrBusy || importing || inboxBusy} onClick={() => ocrInput.current?.click()}>{ocrBusy ? '识别中…（首次需加载中文模型）' : '截图识别（微信／支付宝账单截图）'}</button>
        <small>识别在本机完成，截图不上传；结果进入草稿箱等待你确认。</small>
      </div>
      <input type="file" hidden accept="image/png,image/jpeg,image/webp" ref={ocrInput} onChange={event => { const f = event.target.files?.[0]; event.target.value = ''; void recognizeShot(f) }} />
      {drafts === null ? <p className={styles.empty} role="status">正在读取草稿箱…</p> : drafts.length === 0 ? <p className={styles.empty}>草稿箱是空的。可以在「消费」里导入微信或支付宝的官方账单 CSV。</p> : <>
        <div className={styles.inboxActions}>
          <button type="button" disabled={inboxBusy || importing} onClick={() => setSelectedDrafts(drafts.map(draft => draft.id))}>全选</button>
          <button type="button" disabled={inboxBusy || importing} onClick={() => setSelectedDrafts([])}>清除选择</button>
          <button type="button" className={styles.primary} disabled={inboxBusy || importing || !selectedDrafts.length} onClick={() => void confirmSelectedDrafts()}>{inboxBusy ? '确认中…' : `确认所选入账（${selectedDrafts.length}）`}</button>
          <button type="button" className={styles.danger} disabled={inboxBusy || importing || !selectedDrafts.length} onClick={() => void dismissSelectedDrafts()}>丢弃所选</button>
        </div>
        {Object.entries(drafts.reduce<Record<string, BillDraft[]>>((groups, draft) => {
          const key = dayKeyOf(draft.occurredAt)
          ;(groups[key] ??= []).push(draft)
          return groups
        }, {})).sort(([a], [b]) => b.localeCompare(a)).map(([groupDay, groupDrafts]) => <section key={groupDay} className={styles.inboxDay}>
          <h3>{groupDay}（{groupDrafts.length}）</h3>
          <ul className={styles.list}>{groupDrafts.map(draft => <li key={draft.id} className={styles.row}>
            <input type="checkbox" aria-label={`选择 ${draft.direction === 'in' ? '收入' : '支出'} ¥${formatCents(draft.amountCents)}`} checked={selectedDrafts.includes(draft.id)} onChange={event => setSelectedDrafts(current => event.target.checked ? [...current, draft.id] : current.filter(id => id !== draft.id))} />
            <div className={styles.rowMain}>
              <b>{draft.direction === 'in' ? '收入' : '支出'} ¥{formatCents(draft.amountCents)} · {draft.merchant || '未知商户'}{draft.suspect ? ' ⚠疑似同一笔' : ''}</b>
              <small>{formatRecordTime(draft.occurredAt)}{draft.note ? ` · ${draft.note}` : ''}{draft.channel === 'wechat' ? ' · 微信' : draft.channel === 'alipay' ? ' · 支付宝' : ''} · 确认后归「其他」分类</small>
            </div>
          </li>)}</ul>
        </section>)}
      </>}
    </div> : null}
    {view === 'today' ? <div className={styles.today}>
      <div className={styles.summary} aria-label="当日汇总">
        <span>喝水 {summary.waterMl} mL</span>
        <span>餐食 {summary.mealCount}</span>
        <span>支出 ¥{formatCents(summary.expenseOutCents)}</span>
        <span>收入 ¥{formatCents(summary.expenseInCents)}</span>
        <span>一句话 {summary.noteCount}</span>
      </div>
      {records.length === 0 ? <p className={styles.empty}>{day === today ? '今天还没有记录，切到「记一笔」开始。' : '这一天还没有记录，切到「记一笔」补记。'}</p> : <ul className={styles.list}>
        {records.map(record => <li key={record.id} className={styles.row}>
          {record.photo ? <img className={styles.rowThumb} src={record.photo.sticker} alt="" /> : null}
          <div className={styles.rowMain}>
            <b>{describeLifeRecord(record)}</b>
            <small>{formatRecordTime(record.createdAt)}{record.note ? ` · ${record.note}` : ''}</small>
          </div>
          <div className={styles.rowActions}>
            <button type="button" onClick={() => startEdit(record)}>编辑</button>
            <button type="button" className={confirmingId === record.id ? styles.danger : ''} onClick={() => remove(record)}>
              {confirmingId === record.id ? '确认删除' : '删除'}
            </button>
          </div>
        </li>)}
      </ul>}
      <div className={styles.actions}><button type="button" onClick={onClose}>关闭</button></div>
    </div> : <form className={styles.body} onSubmit={submit}>
      {editing ? <p className={styles.editing}>正在编辑：{describeLifeRecord(editing)}
        <button type="button" disabled={busy || photoBusy || collecting} onClick={cancelEdit}>取消编辑</button>
      </p> : null}
      <div className={styles.kinds} role="group" aria-label="记录类型">
        {KINDS.map(item => <button key={item.value} type="button" aria-pressed={kind === item.value} disabled={busy || photoBusy || collecting || !!editing} onClick={() => { if (kind === item.value) return; setKind(item.value); setError(''); setPhoto(null); setPreset(item.value === 'meal' ? 'meal' : 'cup') }}>{item.label}</button>)}
      </div>
      {kind === 'water' ? <div className={styles.field}>
        <div className={styles.presets} role="group" aria-label="常用饮水量">
          {WATER_PRESETS.map(value => <button key={value} type="button" aria-pressed={Number(ml) === value} onClick={() => setMl(String(value))}>+{value} mL</button>)}
        </div>
        <label htmlFor="qr-ml">毫升数</label>
        <input id="qr-ml" type="number" inputMode="numeric" min={1} max={10000} step={1} value={ml} onChange={event => setMl(event.target.value)} />
      </div> : null}
      {kind === 'meal' ? <div className={styles.field}>
        <label htmlFor="qr-meal-type">餐次</label>
        <select id="qr-meal-type" value={mealType} onChange={event => setMealType(event.target.value as MealType)}>
          {MEAL_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
        <label htmlFor="qr-meal-name">餐名</label>
        <input id="qr-meal-name" type="text" maxLength={60} placeholder="例如：食堂午饭" value={mealName} onChange={event => setMealName(event.target.value)} />
      </div> : null}
      {kind === 'water' || kind === 'meal' ? <div className={styles.field}>
        <span className={styles.photoLabel}>杯子／餐食照片（可选，只存本机）</span>
        <div className={styles.presets} role="group" aria-label="照片预设">
          {PHOTO_PRESETS.map(item => <button key={item.value} type="button" aria-pressed={preset === item.value} disabled={busy || photoBusy || collecting} onClick={() => applyPreset(item.value)}>{item.label}</button>)}
        </div>
        <input ref={photoInput} type="file" accept="image/*" hidden aria-label="选择杯子或餐食照片" onChange={pickPhoto} />
        {photo ? <div className={styles.photoPreview}>
          <img src={photo.sticker} alt="照片贴纸预览" />
          <div className={styles.presets} role="group" aria-label="贴纸边">
            {STICKER_EDGES.map(item => <button key={item.value} type="button" aria-pressed={photo.edge === item.value} disabled={busy || photoBusy || collecting} onClick={() => applyEdge(item.value)}>{item.label}</button>)}
          </div>
          <div className={styles.photoActions}>
            <button type="button" disabled={busy || photoBusy || collecting} onClick={() => photoInput.current?.click()}>重拍／换图</button>
            <button type="button" disabled={busy || photoBusy || collecting} onClick={() => setPhoto(null)}>移除照片</button>
            <button type="button" disabled={busy || photoBusy || collecting} onClick={() => void collectPhoto()}>{collecting ? '正在收藏…' : '收藏贴纸'}</button>
          </div>
        </div> : <button type="button" className={styles.photoAdd} disabled={busy || photoBusy || collecting} onClick={() => photoInput.current?.click()}>{photoBusy ? '正在生成贴纸…' : '拍一张／从相册选'}</button>}
        <small className={styles.photoHint}>本期生成纸边相片贴纸，自动抠图后续提供；照片不会自动推算水量或金额。收藏独立保存在本机，取消生活记录不会撤回已收藏贴纸。</small>
      </div> : null}
      {kind === 'expense' ? <div className={styles.field}>
        <div className={styles.presets} role="group" aria-label="收支方向">
          <button type="button" aria-pressed={direction === 'out'} onClick={() => switchDirection('out')}>支出</button>
          <button type="button" aria-pressed={direction === 'in'} onClick={() => switchDirection('in')}>收入</button>
        </div>
        <label htmlFor="qr-amount">金额（元）</label>
        <input id="qr-amount" type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} />
        <label htmlFor="qr-category">分类</label>
        <select id="qr-category" value={category} onChange={event => setCategory(event.target.value)}>
          {categories.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <label htmlFor="qr-expense-note">备注（可选）</label>
        <input id="qr-expense-note" type="text" maxLength={80} value={expenseNote} onChange={event => setExpenseNote(event.target.value)} />
        <div className={styles.importRow}>
          <button type="button" disabled={importing || busy || photoBusy || collecting || inboxBusy} onClick={() => billInput.current?.click()}>{importing ? '解析中…' : '导入账单（微信／支付宝 CSV）'}</button>
          <small>微信：我→服务→钱包→账单→下载账单（个人对账，发邮箱）；支付宝：我的→账单→开具交易流水证明。解析在本机完成，文件不离开设备。</small>
        </div>
        <input type="file" hidden accept=".csv,text/csv" ref={billInput} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importBillCsv(file) }} />
      </div> : null}
      {kind === 'note' ? <div className={styles.field}>
        <label htmlFor="qr-note">写一句话</label>
        <textarea id="qr-note" rows={3} maxLength={200} value={noteBody} onChange={event => setNoteBody(event.target.value)} />
      </div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={busy || photoBusy || collecting}>{busy ? '保存中…' : photoBusy ? '正在生成贴纸…' : editing ? '保存修改' : '保存'}</button>
      </div>
    </form>}
  </DialogLayer>
}