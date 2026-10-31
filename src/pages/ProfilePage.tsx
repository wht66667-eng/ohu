import { Link, Navigate } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { resolveAvatar } from '../data/images'
import { getAppShell, isWorkShell } from '../lib/app-shell'
import { FoxCodex } from '../components/fox/FoxCodex'
import { StudentServiceArtwork } from '../components/brand/StudentServiceArtwork'
import { FoxSheetPose } from '../components/fox/FoxSheetPose'
import { useFoxState } from '../components/fox/useFoxState'
import { FOX_LABELS } from '../lib/fox-labels'
import { foxPoseForState } from '../lib/fox-sheet'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import { pressFeedback } from '../lib/animations'
import { useUiMotion } from '../lib/motion-pref'
import { FocusThemeToggle } from '../components/focus/FocusInteractions'
import styles from './profile.module.css'

type ProfileIconName = 'task' | 'publish' | 'todo' | 'wallet' | 'message' | 'bell' | 'settings' | 'help' | 'work' | 'arrow' | 'edit' | 'shield'
const ICON_PATHS: Record<ProfileIconName, ReactNode> = {
  task: <><path d="M8 5H5v15h14V5h-3M9 3h6v4H9zM8 12h8M8 16h5" /></>,
  publish: <><path d="M4 8h16v12H4zM8 8V5h8v3M12 11v6M9 14h6" /></>,
  todo: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>,
  wallet: <><path d="M4 7V5h14v3M4 8h16v12H4zM15 12h5v4h-5z" /><path d="M16 14h1" /></>,
  message: <path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5" />,
  bell: <path d="M9 19a3 3 0 0 0 6 0M6 10a6 6 0 0 1 12 0v5l2 2H4l2-2z" />,
  settings: <><path d="m10 3 4 0 .5 3 2.5 1.5 3-.8 2 3.6-2.5 1.9v3l2.5 1.9-2 3.6-3-.8-2.5 1.5L14 24h-4l-.5-3.6L7 18.9l-3 .8-2-3.6 2.5-1.9v-3L2 9.3l2-3.6 3 .8L9.5 5z" transform="translate(1 0) scale(.9)" /><circle cx="12" cy="12" r="3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2l-1.5 1v2M12 17h.01" /></>,
  work: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3" /></>,
  arrow: <path d="m9 5 7 7-7 7" />,
  edit: <path d="m15 4 5 5M4 20l5-1 12-12-5-5L4 14z" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
}

function ProfileIcon({ name }: { name: ProfileIconName }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>
}

const PROFILE_ARTWORK = {
  'section-icon': '生活互助',
  'shortcut-1': '我的待办', 'shortcut-2': '二手交易', 'shortcut-3': '我的待办',
  'row-1': '校园广场', 'row-2': '生活互助', 'row-3': '课表查询',
  'row-4': '校园信息站', 'row-5': '学习计划', 'row-6': '生活互助',
} as const

type ProfileArtworkName = keyof typeof PROFILE_ARTWORK
function ProfileArtwork({ name, className }: { name: ProfileArtworkName; className?: string }) {
  return <span className={className}><StudentServiceArtwork id={name} fallback={PROFILE_ARTWORK[name]} size={38} /></span>
}

function ProfileRow({ to, icon, title, detail }: { to: string; icon: ProfileIconName; title: string; detail?: string }) {
  return <Link to={to} className={styles.row}>
    <span className={styles.rowIcon}><ProfileIcon name={icon} /></span>
    <span className={styles.rowText}><b>{title}</b>{detail ? <span>{detail}</span> : null}</span>
    <span className={styles.arrow}><ProfileIcon name="arrow" /></span>
  </Link>
}

export function ProfilePage() {
  const toast = useToast()
  const auth = useAuth()
  const eng = useFoxState()
  const reduce = useUiMotion()
  const variant = useUiVariant()
  const showFoxArt = !isFoxFreeVariant(variant)
  const [codex, setCodex] = useState(false)
  const workShell = isWorkShell(getAppShell())
  const signed = auth.isSigned

  if (workShell) return <Navigate to="/settings" replace />

  const name = signed ? auth.profile?.username || auth.user?.nickname || '同学' : '欢迎来到哦狐'
  const building = auth.profile?.building || ''
  const myAvatar = signed ? resolveAvatar(auth.user?.avatarUrl, auth.user?.uid || name) : ''
  const roleText = auth.profile?.isSuperAdmin ? '站长' : auth.profile?.isAdmin ? '管理员' : '学生'
  const showWork = signed && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)

  async function openLogin() {
    const ok = await auth.ensureSignedIn('登录后可发布闲置、接单与收藏')
    if (ok) toast.ok('登录成功')
  }

  async function openEdit() {
    if (!signed) {
      const ok = await auth.ensureSignedIn('登录后可更换头像与昵称')
      if (!ok) return
      toast.ok('登录成功')
    }
    auth.openEdit()
  }

  return <div className={styles.page} data-fox-art={showFoxArt ? 'true' : 'false'}>
    <header className={styles.header}>
      <div className={styles.headingCopy}><span>OHU · MY CAMPUS ✦</span><h1>我的校园生活</h1><p>每一个努力的日子，都值得被记录。</p></div>
      <FocusThemeToggle /><Link to="/settings" className={styles.headerAction} aria-label="打开设置"><ProfileIcon name="settings" /></Link>
    </header>

    <section className={styles.account} aria-label="个人账号">
      <div className={styles.accountMain}>
      <div className={styles.identity}>
        <button type="button" className={styles.avatarButton} onClick={openEdit} aria-label={signed ? '编辑头像与资料' : '登录并设置资料'}>
          {myAvatar ? <img className={styles.avatar} src={myAvatar} alt="" width="64" height="64" /> : showFoxArt ? <FoxSheetPose className={styles.guestFox} pose="waving" /> : <span className={styles.guestAvatar} aria-hidden="true">同学</span>}
          {signed ? <span className={styles.avatarEdit}><ProfileIcon name="edit" /></span> : null}
        </button>
        <div className={styles.who}>
          <h2>{name}</h2>
          {signed ? <p><span className={styles.badge}>{roleText}</span>{building ? <span className={styles.building}>{building}</span> : null}</p> : <p>登录后同步资料、发布与消息</p>}
        </div>
      </div>
      <motion.button type="button" className={signed ? styles.editButton : styles.loginButton} aria-label={signed ? '编辑个人资料' : '登录或注册'} onClick={signed ? openEdit : openLogin} {...pressFeedback(reduce, .98)}>
        {signed ? <><ProfileIcon name="edit" /><span>编辑资料</span></> : '登录 / 注册'}
      </motion.button>
      </div>
      {!signed ? <p className={styles.loginHint}>手机验证码或账号密码登录</p> : null}
      {showFoxArt ? <div className={styles.companion}><FoxSheetPose className={styles.accountFox} pose="waving" /><div><b>{signed ? '今天也有小美好' : '你的校园小伙伴'}</b><p>{signed ? '和阿狐打个招呼，继续你的校园日常。' : '先逛逛校园，发现喜欢的生活。'}</p></div></div> : null}
    </section>

    <section className={styles.stats} aria-label="校园快捷入口">
      <Link to="/schedule" className={styles.stat}><StudentServiceArtwork id="schedule" fallback="课表查询" size={38} /><b>我的课表</b><small>课程日程</small></Link>
      <Link to="/campus-map" className={styles.stat}><StudentServiceArtwork id="map" fallback="目标墙" size={38} /><b>地图打卡</b><small>地点与打卡</small></Link>
      <Link to="/todo" className={styles.stat}><StudentServiceArtwork id="todo" fallback="我的待办" size={38} /><b>待办任务</b><small>学习与生活</small></Link>
      <Link to="/notify" className={styles.stat}><StudentServiceArtwork id="messages" fallback="校园广场" size={38} /><b>通知消息</b><small>课程与系统</small></Link>
    </section>

    <aside className={styles.growth}><div><b>用心记录每一次成长</b><span>{showFoxArt ? '今天也和哦狐一起，向喜欢的生活前进一步。' : '向喜欢的生活前进一步。'}</span></div>{showFoxArt ? <FoxSheetPose pose="writing" className={styles.growthFox} /> : null}</aside>

    <section className={styles.section} aria-labelledby="profile-content-title">
      <h2 id="profile-content-title"><ProfileArtwork name="section-icon" className={styles.sectionArtwork} />学习与发布</h2>
      <div className={styles.shortcuts}>
        <Link to="/tasks?tab=favorites" className={styles.shortcut}><span><ProfileArtwork name="shortcut-1" /></span><b>我的收藏</b></Link>
        <Link to="/market?tab=mine" className={styles.shortcut}><span><ProfileArtwork name="shortcut-2" /></span><b>闲置发布</b></Link>
        <Link to="/todo" className={styles.shortcut}><span><ProfileArtwork name="shortcut-3" /></span><b>我的待办</b></Link>
      </div>
    </section>

    <section className={styles.section} aria-labelledby="profile-social-title">
      <h2 id="profile-social-title">我的社交</h2>
      <div className={styles.group}>
        <ProfileRow to="/moments" icon="edit" title="朋友圈" detail="好友动态，支持图文" />
        <ProfileRow to="/contacts" icon="message" title="通讯录" detail="好友与好友申请" />
        <ProfileRow to="/discover" icon="bell" title="发现" detail="校园热点与校园服务" />
      </div>
    </section>

    <section className={styles.section} aria-labelledby="profile-orders-title">
      <h2 id="profile-orders-title">我的发布与校园账号</h2>
      <div className={styles.group}>
        <ProfileRow to="/tasks?tab=mine" icon="publish" title="我发布的任务" detail="查看任务状态与联系记录" />
        <ProfileRow to="/study?tab=ports" icon="shield" title="校园账号与入口" detail="管理本机校园账号，前往学校平台" />
      </div>
    </section>

    {showWork ? <section className={styles.section} aria-labelledby="profile-work-title">
      <h2 id="profile-work-title">管理工作台</h2>
      <div className={styles.group}>
        <ProfileRow to="/admin/content" icon="shield" title="内容治理" detail="帖子、举报与成员管理" />
      </div>
    </section> : null}

    <section className={styles.section} aria-labelledby="profile-message-title">
      <h2 id="profile-message-title">消息与账号</h2>
      <div className={styles.group}>
        <ProfileRow to="/messages" icon="message" title="消息与进度" detail="任务、报名与申请动态" />
        <ProfileRow to="/notify" icon="bell" title="通知中心" detail="查看校园与系统提醒" />
        <ProfileRow to="/settings" icon="settings" title="应用设置" detail="外观、提醒与账号管理" />
      </div>
    </section>

    <section className={styles.section} aria-labelledby="profile-help-title">
      <h2 id="profile-help-title">帮助与反馈</h2>
      <div className={styles.group}>
        <ProfileRow to="/settings?section=about" icon="shield" title="哦狐科技" detail="插件共创、管理员审核与版本更新" />
        <ProfileRow to="/contact" icon="help" title="联系管理员" detail="提交问题或改进建议" />
      </div>
    </section>

    {showFoxArt ? <button type="button" className={styles.foxRow} onClick={() => setCodex(true)} aria-label="打开阿狐表情图鉴">
      <FoxSheetPose className={styles.codexPreview} pose={foxPoseForState(eng?.iconState)} />
      <span className={styles.foxText}>
        <b>{FOX_LABELS[eng?.iconState || 'default']}</b>
        <span>{signed && eng?.checkedInToday ? `连续登录 ${Math.max(1, eng.streakCurrent)} 天 · 最长 ${eng.streakBest} 天` : '查看阿狐的表情图鉴'}</span>
      </span>
      <span className={styles.foxAction}>图鉴<ProfileIcon name="arrow" /></span>
    </button> : null}

    {codex ? <FoxCodex onClose={() => setCodex(false)} /> : null}
  </div>
}
