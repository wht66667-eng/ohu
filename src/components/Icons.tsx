import type { ReactNode } from 'react'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'

type IconProps = { size?: number; color?: string }

/** 服务入口图标调色板：每种服务一对「浅 → 深」色，用于果冻渐变。 */
const PALETTE = {
  heart: { light: '#ffb4c8', deep: '#ff4d7d' },
  bus: { light: '#9dbeff', deep: '#3a78f0' },
  bag: { light: '#ffdd8a', deep: '#e0a300' },
  food: { light: '#ffbf80', deep: '#ff7a18' },
  cal: { light: '#b6aaff', deep: '#7b6bff' },
  sun: { light: '#ffe27d', deep: '#ffb300' },
  task: { light: '#aee183', deep: '#4fae2b' },
  shop: { light: '#ffc99a', deep: '#f4762a' },
  paw: { light: '#aee183', deep: '#4fae2b' },
  chat: { light: '#95d5ff', deep: '#2f9bff' },
  flash: { light: '#ffcb7a', deep: '#ff8a1f' },
  // 小店街子主题：紫罗兰，与食堂绿/橙区分（合伙人招募略浅一档做层次）
  store: { light: '#c3b4ff', deep: '#6c4cf1' },
  partner: { light: '#d9c9ff', deep: '#8a6bff' },
}

/**
 * 渐变软糖底：把任意剪影填充成「上浅下深渐变 + 左上高光 + 底部内阴影 + 一圈内柔光」，
 * 得到半透明果冻质感。剪影元素本身不要写 fill/stroke，交给外层继承；
 * 需要压在剪影之上的高光细节用 detail 传入。
 */
function Gummy({
  id,
  light,
  deep,
  color,
  size = 22,
  shape,
  detail,
}: {
  id: string
  light: string
  deep: string
  color?: string
  size?: number
  shape: ReactNode
  detail?: ReactNode
}) {
  const uid = `xm-gummy-${id}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-fill`} x1="4" y1="2.5" x2="20" y2="21.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={color ?? deep} />
        </linearGradient>
        <radialGradient id={`${uid}-gloss`} cx="0.34" cy="0.22" r="0.66">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-shade`} x1="12" y1="8" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4a2a10" stopOpacity="0" />
          <stop offset="1" stopColor="#4a2a10" stopOpacity="0.26" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>{shape}</clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect x="0" y="0" width="24" height="24" fill={`url(#${uid}-fill)`} />
        <rect x="0" y="0" width="24" height="24" fill={`url(#${uid}-gloss)`} />
        <rect x="0" y="0" width="24" height="24" fill={`url(#${uid}-shade)`} />
        <g fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.7">
          {shape}
        </g>
      </g>
      {detail}
    </svg>
  )
}

export function IconHeart({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="heart"
      {...PALETTE.heart}
      color={color}
      size={size}
      shape={
        <path d="M12 20.4s-7.2-4.5-7.2-9.4C4.8 7.9 6.7 6.1 9 6.1c1.2 0 2.3.6 3 1.5.7-.9 1.8-1.5 3-1.5 2.3 0 4.2 1.8 4.2 4.9 0 4.9-7.2 9.4-7.2 9.4z" />
      }
      detail={
        <path
          d="M8.1 8.6c-1 .4-1.6 1.2-1.7 2.2"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.7"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      }
    />
  )
}

export function IconBus({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="bus"
      {...PALETTE.bus}
      color={color}
      size={size}
      shape={
        <>
          <rect x="3" y="3.8" width="18" height="12.9" rx="3.4" />
          <circle cx="7.7" cy="18.2" r="2.3" />
          <circle cx="16.3" cy="18.2" r="2.3" />
        </>
      }
      detail={
        <>
          <rect x="5.3" y="6.2" width="5.2" height="3.4" rx="1.1" fill="#ffffff" fillOpacity="0.88" />
          <rect x="13.5" y="6.2" width="5.2" height="3.4" rx="1.1" fill="#ffffff" fillOpacity="0.88" />
          <rect x="5.3" y="11.9" width="13.4" height="1.3" rx="0.65" fill="#ffffff" fillOpacity="0.45" />
          <circle cx="7.7" cy="18.2" r="0.95" fill="#ffffff" fillOpacity="0.85" />
          <circle cx="16.3" cy="18.2" r="0.95" fill="#ffffff" fillOpacity="0.85" />
        </>
      }
    />
  )
}

export function IconBag({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="bag"
      {...PALETTE.bag}
      color={color}
      size={size}
      shape={
        <>
          <path d="M5.2 9.4a2.6 2.6 0 0 1 2.6-2.3h8.4a2.6 2.6 0 0 1 2.6 2.3l.9 9.6a2.2 2.2 0 0 1-2.2 2.4H6.5a2.2 2.2 0 0 1-2.2-2.4l.9-9.6z" />
          <path d="M8.7 8.9A3.3 3.3 0 0 1 15.3 8.9L13.5 8.9A1.5 1.5 0 0 0 10.5 8.9Z" />
        </>
      }
      detail={
        <path
          d="M7.4 12.7h9.2"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      }
    />
  )
}

export function IconFood({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="food"
      {...PALETTE.food}
      color={color}
      size={size}
      shape={
        <>
          <path d="M3.4 11.2h17.2v1.5a6.5 6.5 0 0 1-6.5 6.5h-4.2a6.5 6.5 0 0 1-6.5-6.5v-1.5z" />
          <rect x="9.1" y="20.4" width="5.8" height="1.8" rx="0.9" />
        </>
      }
      detail={
        <>
          <rect x="8.2" y="4.2" width="1.7" height="5" rx="0.85" fill="#ff8f2e" fillOpacity="0.75" />
          <rect x="11.2" y="3" width="1.7" height="6.2" rx="0.85" fill="#ff8f2e" fillOpacity="0.75" />
          <rect x="14.2" y="4.2" width="1.7" height="5" rx="0.85" fill="#ff8f2e" fillOpacity="0.75" />
          <rect x="5.6" y="12.6" width="6.4" height="1.1" rx="0.55" fill="#ffffff" fillOpacity="0.5" />
        </>
      }
    />
  )
}

export function IconCal({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="cal"
      {...PALETTE.cal}
      color={color}
      size={size}
      shape={
        <>
          <rect x="3.4" y="5" width="17.2" height="15.8" rx="4" />
          <rect x="7.5" y="2.6" width="1.9" height="4.4" rx="0.95" />
          <rect x="14.6" y="2.6" width="1.9" height="4.4" rx="0.95" />
        </>
      }
      detail={
        <>
          <path d="M7.4 5h9.2a4 4 0 0 1 4 4v.9H3.4V9a4 4 0 0 1 4-4z" fill="#ffffff" fillOpacity="0.82" />
          <circle cx="7.8" cy="13.4" r="1" fill="#ffffff" fillOpacity="0.92" />
          <circle cx="12" cy="13.4" r="1" fill="#ffffff" fillOpacity="0.92" />
          <circle cx="16.2" cy="13.4" r="1" fill="#ffffff" fillOpacity="0.92" />
          <circle cx="7.8" cy="17.2" r="1" fill="#ffffff" fillOpacity="0.6" />
          <circle cx="12" cy="17.2" r="1" fill="#ffffff" fillOpacity="0.6" />
          <circle cx="16.2" cy="17.2" r="1" fill="#ffffff" fillOpacity="0.6" />
        </>
      }
    />
  )
}

export function IconSunMini({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="sun"
      {...PALETTE.sun}
      color={color}
      size={size}
      shape={
        <>
          <circle cx="12" cy="12" r="6.6" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(45 12 12)" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(90 12 12)" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(135 12 12)" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(180 12 12)" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(225 12 12)" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(270 12 12)" />
          <rect x="11.15" y="1.5" width="1.7" height="4.2" rx="0.85" transform="rotate(315 12 12)" />
        </>
      }
      detail={
        <>
          <circle cx="9.8" cy="11.1" r="1" fill="#8a5a00" />
          <circle cx="14.2" cy="11.1" r="1" fill="#8a5a00" />
          <path
            d="M9.5 14.2c1 1.4 4 1.4 5 0"
            fill="none"
            stroke="#8a5a00"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </>
      }
    />
  )
}

export function IconTask({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="task"
      {...PALETTE.task}
      color={color}
      size={size}
      shape={
        <>
          <rect x="4.2" y="4.6" width="15.6" height="16.4" rx="3.8" />
          <rect x="8.6" y="2.4" width="6.8" height="4.2" rx="2.1" />
        </>
      }
      detail={
        <>
          <path
            d="M8.6 12.4l2.1 2.1 4.7-4.7"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8.6 17.6h6.4"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.75"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      }
    />
  )
}

export function IconShop({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="shop"
      {...PALETTE.shop}
      color={color}
      size={size}
      shape={
        <>
          <path d="M3.6 9.4V8a4 4 0 0 1 4-4h8.8a4 4 0 0 1 4 4v1.4a2.667 2.6 0 0 1-5.333 0 2.667 2.6 0 0 1-5.333 0 2.667 2.6 0 0 1-5.334 0z" />
          <path d="M4.7 12.1h14.6v6.5a1.7 1.7 0 0 1-1.7 1.7H6.4a1.7 1.7 0 0 1-1.7-1.7v-6.5z" />
        </>
      }
      detail={
        <>
          <rect x="10.2" y="14.4" width="3.6" height="5.9" rx="1.2" fill="#ffffff" fillOpacity="0.9" />
          <rect x="6.3" y="14.4" width="2.7" height="2.7" rx="0.9" fill="#ffffff" fillOpacity="0.62" />
          <rect x="15" y="14.4" width="2.7" height="2.7" rx="0.9" fill="#ffffff" fillOpacity="0.62" />
        </>
      }
    />
  )
}

/** 小店街：两间高低错落的临街小铺，一眼区分于「二手交易」的单店剪影 */
export function IconStore({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="store"
      {...PALETTE.store}
      color={color}
      size={size}
      shape={
        <>
          <path d="M2.8 20.4V10.6l4.3-2.9 4.3 2.9v9.8z" />
          <path d="M12.6 20.4V12.9l3.5-2.4 3.5 2.4v7.5z" />
        </>
      }
      detail={
        <>
          <rect x="5.4" y="12.6" width="3.2" height="3.2" rx="1" fill="#ffffff" fillOpacity="0.88" />
          <rect x="7.9" y="17.6" width="2.4" height="2.8" rx="0.9" fill="#ffffff" fillOpacity="0.55" />
          <rect x="14.6" y="14.3" width="2.6" height="2.6" rx="0.9" fill="#ffffff" fillOpacity="0.7" />
        </>
      }
    />
  )
}

/** 合伙人招募：一只喇叭，对应「楼栋合伙人招募」的广播语义 */
export function IconPartner({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="partner"
      {...PALETTE.partner}
      color={color}
      size={size}
      shape={
        <path d="M4 9.5h3.5L15.8 4.6v14.8L7.5 14.5H4a1.2 1.2 0 0 1-1.2-1.2v-2.6A1.2 1.2 0 0 1 4 9.5z" />
      }
      detail={
        <>
          <rect x="5.6" y="10.9" width="2.4" height="2.2" rx="0.8" fill="#ffffff" fillOpacity="0.82" />
          <path
            d="M18.1 9.6a4.4 4.4 0 0 1 0 4.8"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.72"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      }
    />
  )
}

export function IconPaw({ size = 22 }: IconProps) {
  const foxfree = isFoxFreeVariant(useUiVariant())
  /* 无狐皮肤：换成通用星形图标，不出现狐狸图。 */
  if (foxfree) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l2.4 5.4L20 9.6l-4.2 3.8 1.2 5.9L12 16.2 7 19.3l1.2-5.9L4 9.6l5.6-1.2Z"/></svg>
  return <img src={`${import.meta.env.BASE_URL}pixel-fox/cheer.png`} width={size} height={size} alt="" aria-hidden="true" />
}

export function IconChat({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="chat"
      {...PALETTE.chat}
      color={color}
      size={size}
      shape={
        <path d="M5.4 4.4h13.2a3.6 3.6 0 0 1 3.6 3.6v7.4a3.6 3.6 0 0 1-3.6 3.6H9.8l-3.9 3.1a.9.9 0 0 1-1.5-.7v-2.7a3.6 3.6 0 0 1-2.4-3.3V8a3.6 3.6 0 0 1 3.4-3.6z" />
      }
      detail={
        <>
          <circle cx="8" cy="11.7" r="1.3" fill="#ffffff" fillOpacity="0.9" />
          <circle cx="12" cy="11.7" r="1.3" fill="#ffffff" fillOpacity="0.9" />
          <circle cx="16" cy="11.7" r="1.3" fill="#ffffff" fillOpacity="0.9" />
        </>
      }
    />
  )
}

export function IconFlash({ size = 22, color }: IconProps) {
  return (
    <Gummy
      id="flash"
      {...PALETTE.flash}
      color={color}
      size={size}
      shape={
        <path d="M13.7 2.3 5.3 13.2a.95.95 0 0 0 .75 1.5h4.3l-1.15 6.7a.95.95 0 0 0 1.7.75l8.4-10.9a.95.95 0 0 0-.75-1.5h-4.3l1.15-6.7a.95.95 0 0 0-1.7-.75z" />
      }
      detail={
        <path
          d="M11.6 6.2 7.9 11"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      }
    />
  )
}

export function IconSearch({ size = 18, color = '#8aa08a' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.2 4.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconBack({ size = 20, color = '#2c3a2c' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2">
      <path d="M15 5 8 12l7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconHome({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9">
      <path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8z" />
    </svg>
  )
}

export function IconGrid({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9">
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </svg>
  )
}

export function IconBell({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9">
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.2 2H4.8L6 16z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

/** 公告 / 广播喇叭：管理端底栏「公告」页签 */
export function IconMegaphone({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinejoin="round">
      <path d="M4 10.2v3.6a1 1 0 0 0 1 1h1.6L13 18.6V5.4L6.6 9.2H5a1 1 0 0 0-1 1z" />
      <path d="M16.4 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.8 6.8a7.4 7.4 0 0 1 0 10.4" />
    </svg>
  )
}

/** Tab 栏用线框气泡（果冻版 IconChat 留给首页宫格） */
export function IconPlaza({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9">
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H11l-3.6 2.7a.7.7 0 0 1-1.1-.55V16H7.5A2.5 2.5 0 0 1 5 13.5v-7z" strokeLinejoin="round" />
      <circle cx="9" cy="10" r="0.9" fill={color} stroke="none" />
      <circle cx="12" cy="10" r="0.9" fill={color} stroke="none" />
      <circle cx="15" cy="10" r="0.9" fill={color} stroke="none" />
    </svg>
  )
}

export function IconUser({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19c1.4-3.2 3.6-4.6 7-4.6s5.6 1.4 7 4.6" />
    </svg>
  )
}

export function IconPlus({ size = 26, color = '#fff' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

export function IconStar({ size = 20, color = '#ffc107' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="m12 3 2.4 6.4H21l-5.2 3.9 2 6.4L12 16.6 6.2 19.7l2-6.4L3 9.4h6.6z" />
    </svg>
  )
}

export function IconSend({ size = 18, color = '#fff' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M3 12 21 4l-7 17-2.4-6.6z" />
    </svg>
  )
}

/** 图片：私信/发帖的图片入口 */
export function IconImage({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" stroke={color} strokeWidth="1.8" />
      <circle cx="8.6" cy="10" r="1.6" fill={color} />
      <path d="M4 17l4.4-4.2a2 2 0 0 1 2.7 0L15 16.5l1.9-1.7a2 2 0 0 1 2.7.1L21 16.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 笑脸：表情面板入口 */
export function IconSmile({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.1" fill={color} />
      <circle cx="15" cy="10" r="1.1" fill={color} />
      <path d="M8.4 14.2a4.6 4.6 0 0 0 7.2 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconPin({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12zm0-9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  )
}

/** 齿轮：设置入口图标 */
export function IconGear({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function IconClock({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" strokeLinecap="round" />
    </svg>
  )
}

export function IconWechat({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#07c160">
      <path d="M9.5 7.2c-3.6 0-6.5 2.4-6.5 5.3 0 1.7.9 3.2 2.4 4.2l-.6 2.1 2.4-1.2c.7.2 1.5.3 2.3.3.3 0 .6 0 .9-.1-.2-.6-.3-1.2-.3-1.8 0-3.2 3-5.8 6.7-5.8.2 0 .4 0 .6 0C16.8 8.8 13.5 7.2 9.5 7.2zm-2.2 3.1a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm4.4 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z" />
      <path d="M20.8 14.8c0-2.5-2.5-4.5-5.6-4.5s-5.6 2-5.6 4.5 2.5 4.5 5.6 4.5c.6 0 1.2-.1 1.8-.2l2 .9-.5-1.8c1.4-.8 2.3-2.1 2.3-3.4zm-7.4-1a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm3.6 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
    </svg>
  )
}

export function IconPhone({ size = 20, color = 'var(--green)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M7.2 3.5h2.3l1 4.2-1.7 1a12.5 12.5 0 0 0 5.5 5.5l1-1.7 4.2 1v2.3c0 .8-.7 1.5-1.5 1.5C9.8 17.3 6.7 14.2 6.7 5c0-.8.7-1.5 1.5-1.5z" />
    </svg>
  )
}

export function IconCopy({ size = 16, color = 'var(--green)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function IconSpeaker({ size = 16, color = 'var(--green)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M4 9h4l6-4v14l-6-4H4z" />
      <path d="M17 9.5c.9.8.9 3.2 0 4" fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  )
}

export function IconBook({ size = 22, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 5.2c0-.9.7-1.6 1.6-1.6H12v15.2H6.1c-.9 0-1.6-.7-1.6-1.6V5.2Z"
        stroke={color || 'currentColor'}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M19.5 5.2c0-.9-.7-1.6-1.6-1.6H12v15.2h5.9c.9 0 1.6-.7 1.6-1.6V5.2Z"
        stroke={color || 'currentColor'}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 3.6v15.2" stroke={color || 'currentColor'} strokeWidth="1.5" />
    </svg>
  )
}

export const serviceIconMap: Record<string, (p?: IconProps) => ReturnType<typeof IconHeart>> = {
  heart: (p) => <IconHeart {...p} />,
  bus: (p) => <IconBus {...p} />,
  bag: (p) => <IconBag {...p} />,
  food: (p) => <IconFood {...p} />,
  cal: (p) => <IconCal {...p} />,
  sun: (p) => <IconSunMini {...p} />,
  task: (p) => <IconTask {...p} />,
  shop: (p) => <IconShop {...p} />,
  paw: (p) => <IconPaw {...p} />,
  chat: (p) => <IconChat {...p} />,
  flash: (p) => <IconFlash {...p} />,
  store: (p) => <IconStore {...p} />,
  partner: (p) => <IconPartner {...p} />,
  book: (p) => <IconBook {...p} />,
}
