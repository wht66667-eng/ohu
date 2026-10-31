import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { SubmitButton } from '../components/ui/motion-ui'
import {
  FEEDBACK_CATEGORIES,
  createFeedback,
  type FeedbackCategory,
} from '../lib/feedback'
import styles from './contact.module.css'
import sheet from '../components/TaskSheet.module.css'

export function ContactPage() {
  const [params] = useSearchParams()
  const pluginTopic = params.get('topic') === 'plugin'
  const auth = useAuth()
  const toast = useToast()
  const [category, setCategory] = useState<FeedbackCategory>('suggest')
  const [title, setTitle] = useState(() => pluginTopic ? '插件接入申请' : '')
  const [content, setContent] = useState(() => pluginTopic ? '插件名称与版本：\n作者／团队：\n用途与主要功能：\n公开 GitHub 仓库地址：\n固定源码 commit：\n插件 ID、分类、哦狐入口和最小权限：\n数据读写与网络访问：\n依赖、代码／素材许可证及来源说明：\n兼容范围：\n实际完成的检查与结果：\n' : '')
  const [busy, setBusy] = useState(false)
  const [waitingLogin, setWaitingLogin] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [invalidField, setInvalidField] = useState<'title' | 'content' | null>(null)
  const submitting = useRef(false)
  const titleInput = useRef<HTMLInputElement>(null)
  const contentInput = useRef<HTMLTextAreaElement>(null)

  function clearResult() {
    setDone(false)
    setErr('')
    setInvalidField(null)
  }

  async function submit() {
    if (submitting.current) return
    if (!title.trim()) {
      setDone(false)
      setErr('请填写标题')
      setInvalidField('title')
      titleInput.current?.focus()
      return
    }
    if (!content.trim()) {
      setDone(false)
      setErr('请填写具体内容')
      setInvalidField('content')
      contentInput.current?.focus()
      return
    }
    // Guard synchronously, including the asynchronous login step.
    submitting.current = true
    clearResult()
    setBusy(true)
    setWaitingLogin(auth.phase !== 'signed' || !auth.user)
    try {
      if (!(await auth.ensureSignedIn('留言需要先登录'))) return
      setWaitingLogin(false)
      const res = await createFeedback({
        category,
        title: title.trim(),
        content: content.trim(),
        creator_name: auth.profile?.username || auth.user?.nickname || '同学',
      })
      if (res.error) {
        setErr(res.error)
        toast.err(res.error)
        return
      }
      // Only a confirmed API result may show the success mark.
      setDone(true)
      toast.ok('留言已提交')
      setTitle('')
      setContent('')
    } catch {
      const message = '暂时无法确认提交结果，内容已保留，请稍后再试。'
      setErr(message)
      toast.err(message)
    } finally {
      submitting.current = false
      setBusy(false)
      setWaitingLogin(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title="联系管理员" />
      <section className={styles.intro} aria-labelledby="contact-intro-title">
        <span className={styles.introIcon} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 18H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 3v-3Z" />
            <path d="M7 9h10M7 13h6" />
          </svg>
        </span>
        <div>
          <h2 id="contact-intro-title">{pluginTopic ? '提交插件接入方案' : '有问题，直接留言'}</h2>
          <p>{pluginTopic ? '此表单提交插件方案与 GitHub 仓库链接，不支持直接上传源码文件。请提供固定 commit，并分别说明代码、图片、字体和数据许可，以及插件的数据与网络行为。管理员审核通过后由哦狐维护者静态接入并随新版发布；请勿提交密钥、密码或真实用户数据。' : '写清时间、地点和遇到的问题，便于处理。'}</p>
        </div>
      </section>

      <form className={styles.form} aria-label="留言反馈" aria-busy={busy} noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <h2 className={styles.formTitle}>留言反馈</h2>
        <div className={sheet.field}>
          <span id="feedback-type-label" className={styles.fieldLabel}>类型</span>
          <div className={styles.categories} role="group" aria-labelledby="feedback-type-label">
            {FEEDBACK_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={busy}
                aria-pressed={category === c.value}
                className={`${styles.category} ${category === c.value ? styles.selected : ''}`}
                onClick={() => { setCategory(c.value); clearResult() }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className={sheet.field}>
          <label htmlFor="fb-title">
            标题<em>必填</em>
          </label>
          <input
            id="fb-title"
            ref={titleInput}
            className={sheet.input}
            value={title}
            disabled={busy}
            required
            aria-invalid={invalidField === 'title'}
            aria-describedby={invalidField === 'title' ? 'fb-error' : undefined}
            onChange={(e) => { setTitle(e.target.value); clearResult() }}
            placeholder="一句话概括"
            maxLength={40}
          />
        </div>
        <div className={sheet.field}>
          <label htmlFor="fb-body">
            内容<em>必填</em>
          </label>
          <textarea
            id="fb-body"
            ref={contentInput}
            className={sheet.area}
            rows={4}
            value={content}
            disabled={busy}
            required
            aria-invalid={invalidField === 'content'}
            aria-describedby={invalidField === 'content' ? 'fb-error' : undefined}
            onChange={(e) => { setContent(e.target.value); clearResult() }}
            placeholder="尽量写清时间、地点、诉求…"
            maxLength={500}
          />
        </div>
        <div aria-live="polite" aria-atomic="true">
          {err ? <p id="fb-error" className={styles.error}>{err}</p> : null}
          {done ? <p className={styles.success}>留言已提交</p> : null}
        </div>
        <div className={styles.submitWrap}>
          <SubmitButton type="submit" className={styles.submit} state={busy ? 'busy' : done ? 'done' : 'idle'} label={err ? '重试提交' : '提交留言'} busyText={waitingLogin ? '请先完成登录…' : '提交中…'} doneText="已提交" />
        </div>
      </form>
    </div>
  )
}
