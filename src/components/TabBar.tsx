import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { SOFT, SPRING, uiTransition } from '../lib/animations'
import { IconGrid, IconHome, IconBell, IconUser, IconPlus, IconPlaza, IconMegaphone, IconCal } from './Icons'
import { getAppShell, isWorkShell, type AppShell } from '../lib/app-shell'
import styles from './TabBar.module.css'
import { FoxPaw } from './fox/FoxMarks'
import { foxAssetUrl } from '../lib/fox-art'
import { useUiVariant } from '../lib/ui-variant'
import { useAuth } from '../lib/auth'
import { getShellBadgeCount, shellBadgeOwnerKey, shellBadgeText, subscribeShellBadge } from '../lib/shell-badge'

const SERVICE_ROUTES = new Set(['/services', '/tasks', '/market', '/info', '/schedule', '/study', '/english', '/words', '/zhongce', '/todo', '/sports', '/campus-map', '/nearby-food', '/campus-card', '/bus', '/library'])

export function TabBar({ onPlus }: { onPlus: () => void }) {
  const { pathname, search } = useLocation()
  const shell = getAppShell()
  const reduce = useReducedMotion()

  if (isWorkShell(shell)) {
    return <WorkTabBar shell={shell} pathname={pathname} search={search} />
  }

  return <StudentTabBar pathname={pathname} onPlus={onPlus} reduce={!!reduce} />
}

function StudentTabBar({
  pathname,
  onPlus,
  reduce,
}: {
  pathname: string
  onPlus: () => void
  reduce: boolean
}) {
  const variant = useUiVariant()
  const plainHome = pathname === '/'
  const fox = !plainHome && (variant === 'fox' || variant === 'cute' || variant === 'immersive')
  const cute = !plainHome && (variant === 'cute' || variant === 'immersive')
  const minimal = plainHome || variant === 'minimal'
  const scheduleTab = pathname === '/schedule'
  const [publishing, setPublishing] = useState(false)
  return (
    <motion.nav
      className={`${styles.wrap} ${plainHome ? styles.homeWrap : ''}`}
      initial={reduce ? false : { y: minimal ? 6 : 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={reduce ? { duration: 0 } : minimal ? SOFT : SPRING}
      aria-label="主导航"
    >
      <Tab to="/" label="首页" icon={fox ? <img src={foxAssetUrl('avatar')} className={styles.foxTab} width="28" height="28" alt="" /> : <IconHome size={22} />} active={pathname === '/'} plain={plainHome} />
      <Tab
        to={scheduleTab ? '/schedule' : '/services'}
        label={scheduleTab ? '课程' : '服务'}
        icon={scheduleTab ? <IconCal size={22} /> : fox ? <FoxPaw size={23} /> : <IconGrid size={22} />}
        active={[...SERVICE_ROUTES].some(path => pathname === path || pathname.startsWith(`${path}/`))}
        plain={plainHome}
      />
      {/* 发布键只保留底栏中央圆钮，不再提供右下悬浮位置选项 */}
      <div className={styles.plusSlot}>
        <motion.button
          type="button"
          className={styles.plus}
          aria-label="发布"
          aria-haspopup="dialog"
          onClick={onPlus}
          onPointerDown={() => setPublishing(true)}
          onPointerUp={() => setPublishing(false)}
          onPointerCancel={() => setPublishing(false)}
          onPointerLeave={() => setPublishing(false)}
          transition={reduce ? { duration: 0 } : cute ? { duration: .35, ease: [.34,1.56,.64,1] } : SOFT}
          whileTap={reduce ? undefined : { scale: minimal ? .98 : cute ? .96 : .92 }}
          whileHover={reduce || minimal ? undefined : { scale: 1.04 }}
        >
          {cute ? <motion.span className={styles.publishEars} aria-hidden="true" animate={publishing && !reduce ? { rotate: [-8,8,-4,0] } : { rotate: 0 }} transition={{ duration: .35 }}><i /><i /></motion.span> : null}
          <IconPlus color="currentColor" />
          {fox ? <span className={styles.pawFeedback}><FoxPaw size={24} /></span> : null}
        </motion.button>
        <span className={styles.plusLabel}>发布</span>
      </div>
      <Tab to="/plaza" label="广场" icon={<IconPlaza size={22} />} active={pathname === '/plaza' || pathname.startsWith('/plaza/')} plain={plainHome} />
      <Tab to="/profile" label="我的" icon={<IconUser size={22} />} active={pathname === '/profile' || pathname.startsWith('/profile/') || pathname.startsWith('/settings')} plain={plainHome} />
    </motion.nav>
  )
}

/** 管理端底栏：内容治理 · 公告 · 消息 · 设置 */
function WorkTabBar({
  shell,
  pathname,
}: {
  shell: AppShell
  pathname: string
  search: string
}) {
  const reduce = useReducedMotion()
  const auth = useAuth()
  const ownerKey = shellBadgeOwnerKey(auth.isSigned ? auth.user?.uid || '' : '', shell)
  const badge = useSyncExternalStore(subscribeShellBadge, () => getShellBadgeCount(ownerKey), () => 0)
  const lastBadge = useRef({ ownerKey, count: badge })
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const previous = lastBadge.current
    lastBadge.current = { ownerKey, count: badge }
    if (previous.ownerKey !== ownerKey) setAnnouncement('')
    else if (previous.count !== badge) setAnnouncement(shellBadgeText('消息', badge))
  }, [ownerKey, badge])
  const wrapProps = {
    className: `${styles.wrap} ${styles.workWrap}`,
    initial: reduce ? false : ({ y: 24, opacity: 0 } as const),
    animate: { y: 0, opacity: 1 },
    transition: reduce ? { duration: 0 } : SPRING,
    'aria-label': '管理导航',
  }
  const msgOn = pathname === '/messages' || pathname.startsWith('/chats') || pathname.startsWith('/im/')
  const setOn = pathname.startsWith('/settings')

  return (
    <motion.nav {...wrapProps} data-shell={shell}>
      <Tab
        to="/admin/content"
        label="治理"
        icon={<IconPlaza size={22} />}
        active={
          pathname.startsWith('/admin/content') ||
          pathname.startsWith('/admin/reports') ||
          pathname.startsWith('/admin/members')
        }
      />
      <Tab to="/admin/news" label="公告" icon={<IconMegaphone size={22} />} active={pathname.startsWith('/admin/news')} />
      <Tab to="/messages" label="消息" icon={<IconBell size={22} />} active={msgOn} badge={badge} />
      <Tab to="/settings" label="设置" icon={<IconUser size={22} />} active={setOn} />
      <span className={styles.liveStatus} aria-live="polite" aria-atomic="true">{announcement}</span>
    </motion.nav>
  )
}

function Tab({
  to,
  label,
  icon,
  active,
  badge,
  plain = false,
}: {
  to: string
  label: string
  icon: ReactNode
  active: boolean
  badge?: number
  plain?: boolean
}) {
  const reduce = useReducedMotion()
  const variant = useUiVariant()
  const cute = !plain && (variant === 'cute' || variant === 'immersive') && !isWorkShell(getAppShell())
  const minimal = plain || variant === 'minimal'
  const lastTap = useRef(0)
  // 双击已激活的 tab：回到本页顶部（微信/微博同款交互）
  const onActivate = () => {
    const now = Date.now()
    if (active && now - lastTap.current < 350) {
      lastTap.current = 0
      const page = document.querySelector<HTMLElement>('[data-app-page]')
      page?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    } else {
      lastTap.current = now
    }
  }
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} aria-label={badge === undefined ? undefined : shellBadgeText(label, badge)} className={`${styles.item} ${active ? styles.on : ''}`} onClick={onActivate}>
      <motion.span
        className={styles.iconStage}
        animate={active && !reduce && !minimal ? { scale: [1, 1.12, 1] } : { scale: 1 }}
        transition={uiTransition(!!reduce)}
      >
        {cute ? <span className={`${styles.navEars} ${active ? styles.navEarsUp : ''}`} aria-hidden="true"><i /><i /></span> : null}
        {icon}
        {badge !== undefined && badge > 0 ? (
          <motion.span key={badge} className={styles.badge} aria-hidden="true" initial={reduce ? false : { scale: .88, opacity: .65 }} animate={{ scale: 1, opacity: 1 }} transition={uiTransition(!!reduce)}>{badge > 99 ? '99+' : badge}</motion.span>
        ) : null}
      </motion.span>
      <span>{label}</span>
    </Link>
  )
}
