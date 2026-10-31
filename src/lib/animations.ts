import type { Variants } from 'motion/react'
import { getUiVariant } from './ui-variant'

/** Campus UI: only transform/opacity; finite transitions settle within 400 ms. */
export const SOFT = { duration: 0.24, ease: [0.22, 1, 0.36, 1] } as const
export const SPRING = { type: 'spring', duration: 0.32, bounce: 0.08 } as const
export const TAP = { duration: 0.16, ease: 'easeOut' } as const
export const FLUID = SPRING
export const BOUNCE = SPRING
export const uiTransition = (reduce = false) => reduce ? { duration: 0 } : getUiVariant() === 'minimal' ? { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const } : SOFT

export function fadeUp(reduce = false) {
  return {
    initial: reduce ? false as const : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduce ? 0 : -4 },
    transition: uiTransition(reduce),
  }
}

export function fadeOnly(reduce = false) {
  return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: uiTransition(reduce) }
}

export function slideSheet(reduce = false) {
  return {
    initial: { opacity: 0, y: reduce ? 0 : 24 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduce ? 0 : 24 },
    transition: uiTransition(reduce),
  }
}

export const revealList: Variants = { hidden: {}, show: { transition: { staggerChildren: 0 } } }
/** Six-option publishing panel: last item settles at 100 + 240 = 340 ms. */
export const revealShortList: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.02 } } }
export const revealItem: Variants = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: SOFT } }
export const springList = revealList
export const springItem = revealItem

export function focusStep(reduce = false): Variants {
  return {
    enter: (direction: number) => ({ opacity: 0, x: reduce ? 0 : direction * 24 }),
    center: { opacity: 1, x: 0, transition: uiTransition(reduce) },
    exit: (direction: number) => ({ opacity: 0, x: reduce ? 0 : -direction * 24, transition: uiTransition(reduce) }),
  }
}
export function fieldShake(error: boolean, reduce = false) {
  return { animate: { x: error && !reduce ? [0, -4, 4, -2, 2, 0] : 0 }, transition: uiTransition(reduce) }
}
export const themeWash = {
  grow: [{ transform: 'scale(0)' }, { transform: 'scale(1)' }],
  fade: [{ opacity: 1 }, { opacity: 0 }],
}
export function floatingStart(reduce: boolean, collapsed: boolean) {
  return { animate: { x: collapsed ? 104 : 0 }, transition: uiTransition(reduce) }
}
export function pressFeedback(reduce = false, scale = 0.97) {
  return { whileTap: reduce ? undefined : { scale }, transition: reduce ? { duration: 0 } : TAP }
}
export function tabFeedback(active: boolean, reduce = false) {
  return { animate: { scale: active && !reduce ? [1, 1.1, 1] : 1 }, transition: uiTransition(reduce) }
}

/** Loading loops differ from finite transitions; sprite poses animate opacity only. */
export const foxFrame: Keyframe[] = [{ opacity: 1, offset: 0 }, { opacity: 1, offset: .2499 }, { opacity: 0, offset: .25 }, { opacity: 0, offset: 1 }]
export const BOOT_MOTION = {
  // Illustrated brand sequence is independent of <=400ms UI transitions and readiness.
  brandTravel: { duration: 900, iterations: 1, fill: 'forwards', easing: 'linear' } as KeyframeAnimationOptions,
  brandGreeting: [{ transform: 'scaleX(1) translateY(0)' }, { transform: 'scaleX(1) translateY(-2px)', offset: .3 }, { transform: 'scaleX(-1) translateY(0)', offset: .7 }, { transform: 'scaleX(-1) translateY(0)' }] as Keyframe[],
  brandEar: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-2deg)', offset: .35 }, { transform: 'rotate(0deg)' }] as Keyframe[],
  brandTail: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(5deg)', offset: .35 }, { transform: 'rotate(-2deg)', offset: .75 }, { transform: 'rotate(0deg)' }] as Keyframe[],
  greeting: { duration: 320, fill: 'forwards', easing: 'ease-out' } as KeyframeAnimationOptions,
  brandText: [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }] as Keyframe[],
  brandTitle: { delay: 1040, duration: 240, fill: 'both', easing: 'ease-out' } as KeyframeAnimationOptions,
  brandSlogan: { delay: 1190, duration: 240, fill: 'both', easing: 'ease-out' } as KeyframeAnimationOptions,
  workBrand: { duration: 180, fill: 'both', easing: 'ease-out' } as KeyframeAnimationOptions,
  brandProp: [{ transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(-4px) rotate(4deg)', offset: .4 }, { transform: 'translateY(0) rotate(0deg)' }] as Keyframe[],
  propPulse: { duration: 320, iterations: 1, fill: 'both', easing: 'ease-out' } as KeyframeAnimationOptions,
  travel: { duration: 2400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' } as KeyframeAnimationOptions,
  campusTravel: { duration: 2400, iterations: Infinity, direction: 'alternate', easing: 'linear' } as KeyframeAnimationOptions,
  pathReveal: { duration: 360, fill: 'both', easing: 'linear' } as KeyframeAnimationOptions,
  props: { duration: 4800, iterations: Infinity, easing: 'linear' } as KeyframeAnimationOptions,
  direction: { duration: 4800, iterations: Infinity, easing: 'steps(1, end)' } as KeyframeAnimationOptions,
  frames: { duration: 800, iterations: Infinity, easing: 'linear' } as KeyframeAnimationOptions,
  facing: [{ transform: 'scaleX(1)', offset: 0 }, { transform: 'scaleX(1)', offset: .4999 }, { transform: 'scaleX(-1)', offset: .5 }, { transform: 'scaleX(-1)', offset: 1 }] as Keyframe[],
  exit: [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }] as Keyframe[],
}
/** Brand storyboard is decorative: readiness can finish it at any frame. */
export const BOOT_BRAND_MOTION = {
  logo: { keyframes: [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], timing: { duration: 300, fill: 'both', easing: 'ease-out' } },
  fox: { keyframes: [{ opacity: 0, transform: 'translateY(68px) scale(.9)' }, { opacity: 1, transform: 'translateY(-5px) scale(1.025)', offset: .78 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], timing: { delay: 280, duration: 450, fill: 'both', easing: 'ease-out' } },
  scene: { keyframes: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], timing: { delay: 850, duration: 450, fill: 'both', easing: 'ease-out' } },
  slogan: { keyframes: [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], timing: { delay: 1250, duration: 280, fill: 'both', easing: 'ease-out' } },
} satisfies Record<string, { keyframes: Keyframe[]; timing: KeyframeAnimationOptions }>
/** Points are sampled from the same SVG path drawn by the startup scene. */
export function foxTravel(width: number, height: number, points?: Array<{ x: number; y: number }>): Keyframe[] {
  const route = points || [[.08, .63], [.24, .66], [.38, .42], [.54, .49], [.73, .71], [.92, .48]].map(([x, y]) => ({ x, y }))
  return route.map(({ x, y }) => ({ transform: `translate(${x * width - 36}px, ${y * height - 48}px)` }))
}
/** Six path pieces reveal together within 360ms; no stroke property animates. */
export function bootPathReveal(index: number, count: number): Keyframe[] {
  const start = Math.max(0, index) / Math.max(1, count)
  const end = Math.min(1, (index + 1) / Math.max(1, count))
  return [{ opacity: 0, offset: 0 }, { opacity: 0, offset: start }, { opacity: .55, offset: end }, { opacity: .55, offset: 1 }]
}
/** A prop moves for at most 320ms when the fox passes, then stays still. */
export function bootPropPulse(fraction: number, prop: 'book' | 'pencil'): Keyframe[] {
  const rest = prop === 'book' ? 'translateY(0) scale(1)' : 'rotate(0deg)'
  const peak = prop === 'book' ? 'translateY(-4px) scale(1.03)' : 'rotate(5deg)'
  const span = 320 / 4800
  const points: Keyframe[] = [{ transform: rest, offset: 0 }]
  for (const crossing of [fraction / 2, 1 - fraction / 2]) {
    const start = Math.max(0, Math.min(1 - span, crossing - span * .45))
    points.push({ transform: rest, offset: start }, { transform: peak, offset: start + span * .45 }, { transform: rest, offset: start + span })
  }
  return [...points, { transform: rest, offset: 1 }]
}
export function foxLoaderTravel(size: number): Keyframe[] {
  return [{ transform: 'translateX(0)' }, { transform: `translateX(${size * 1.4}px)` }]
}
export function switchThumb(checked: boolean, reduce = false) {
  return { animate: { x: checked ? 22 : 0, scaleX: reduce ? 1 : [1, 1.14, 1] }, transition: reduce ? { duration: 0 } : SPRING }
}
export function successFeedback(part: number, reduce = false) {
  return { initial: reduce ? false as const : { opacity: 0, scaleX: part ? 0 : 1, scale: part ? 1 : .8 }, animate: { opacity: 1, scaleX: 1, scale: 1 }, transition: reduce ? { duration: 0 } : { ...SOFT, duration: .16, delay: part * .06 } }
}

/** One bounded ripple per press; its geometry is measured once on pointerdown. */
export function pointerRipple() {
  return { initial: { scale: 0, opacity: .16 }, animate: { scale: 1, opacity: 0 }, transition: { ...SOFT, duration: .36 } }
}
export function submitIconFeedback(reduce = false) {
  return { initial: reduce ? false as const : { opacity: 0, scale: .88 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: reduce ? 1 : .88 }, transition: reduce ? { duration: 0 } : TAP }
}
export function submitLabelFeedback(reduce = false) {
  return { initial: reduce ? false as const : { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: uiTransition(reduce) }
}
/** Busy rotation is an ongoing status loop, separate from <=400ms transitions. */
export function submitBusyFeedback(reduce = false) {
  return { animate: { rotate: reduce ? 0 : 360 }, transition: reduce ? { duration: 0 } : { duration: .8, repeat: Infinity, ease: 'linear' as const } }
}
/** Animate the button content while its physical touch target stays unchanged. */
export const submitPressStates: Variants = { rest: { scale: 1, transition: SPRING }, pressed: { scale: .97, transition: SPRING } }
