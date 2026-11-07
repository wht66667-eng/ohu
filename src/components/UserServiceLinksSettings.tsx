import { useEffect, useState, type FormEvent } from 'react'
import { DialogLayer } from './ui/DialogLayer'
import { useAuth } from '../lib/auth'
import { openExternalUrl } from '../lib/campus-links'
import { addUserServiceLink, readUserServiceLinks, removeUserServiceLink, USER_SERVICE_LINKS_EVENT, userServiceLinksKey, type UserServiceLink } from '../lib/user-service-links'
import s from './user-service-links-settings.module.css'

export function UserServiceLinksSettings() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const [links, setLinks] = useState<UserServiceLink[]>(() => readUserServiceLinks(uid))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const load = () => setLinks(readUserServiceLinks(uid))
    load()
    const onLocal = (event: Event) => { if ((event as CustomEvent<string>).detail === (uid || 'guest')) load() }
    const onStorage = (event: StorageEvent) => { if (event.key === userServiceLinksKey(uid) || event.key == null) load() }
    window.addEventListener(USER_SERVICE_LINKS_EVENT, onLocal)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(USER_SERVICE_LINKS_EVENT, onLocal)
      window.removeEventListener('storage', onStorage)
    }
  }, [uid])

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setLinks(addUserServiceLink(uid, title, url))
      setTitle('')
      setUrl('')
      setError('')
      setDialogOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '入口没有保存，请检查后重试')
    }
  }

  function remove(link: UserServiceLink) {
    try { setLinks(removeUserServiceLink(uid, link.id)) }
    catch { setError(`移除「${link.title}」失败，请重试`) }
  }

  return <>
    <section className={s.panel} aria-labelledby="user-links-title">
      <div className={s.header}>
        <div><h2 id="user-links-title">我的网页快捷入口</h2><p>添加常用校园网页 · 仅本机保存</p></div>
        <button type="button" className={s.add} onClick={() => { setError(''); setDialogOpen(true) }}>＋ 添加入口</button>
      </div>
      {links.length ? <div className={s.list}>{links.map(link => <article className={s.item} key={link.id}>
        <button type="button" className={s.open} onClick={() => openExternalUrl(link.url)}><b>{link.title}</b><small>{new URL(link.url).hostname}</small></button>
        <button type="button" className={s.remove} aria-label={`移除 ${link.title}`} onClick={() => remove(link)}>移除</button>
      </article>)}</div> : <p className={s.empty}>还没有自定义入口。添加 HTTPS 网页即可快速打开；哦狐不会运行脚本或替你填写账号密码。</p>}
      {error && !dialogOpen ? <p className={s.error} role="alert">{error}</p> : null}
    </section>
    {dialogOpen ? <DialogLayer title="添加网页快捷入口" onClose={() => setDialogOpen(false)} className={s.dialog}>
      <div className={s.dialogHead}><h2>添加常用网页</h2><button type="button" onClick={() => setDialogOpen(false)} aria-label="关闭">×</button></div>
      <form className={s.form} onSubmit={save}>
        <label>入口名称<input autoFocus required maxLength={24} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：学院教务平台" /></label>
        <label>HTTPS 网页地址<input required type="url" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.edu.cn" /></label>
        <p>最多添加 12 个。请只添加可信网页；不要填写密码或带登录凭据的链接。</p>
        {error ? <p className={s.error} role="alert">{error}</p> : null}
        <div className={s.actions}><button type="button" className={s.cancel} onClick={() => setDialogOpen(false)}>取消</button><button type="submit" className={s.confirm}>保存入口</button></div>
      </form>
    </DialogLayer> : null}
  </>
}
