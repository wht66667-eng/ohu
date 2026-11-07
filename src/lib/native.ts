/**
 * 原生壳体验层（只在 Capacitor 套壳 App 内生效，H5 下全部空转）
 *
 * 套壳下有三件事浏览器不会自动给我们，必须显式接：
 *   1. 状态栏沉浸——WebView 铺到状态栏下方，同时把真实状态栏高度写进 CSS 变量，
 *      让页面能像 iOS 一样用「安全区」避让（见 index.css 的 --safe-top）。
 *   2. 硬件返回键——安卓物理/手势返回默认直接把 Activity 关掉，必须接管成
 *      「关弹层 → 回上一页 → 最小化应用」，否则用户一按返回就被踢出 App。
 *   3. 下拉刷新——WebView 没有浏览器的原生下拉刷新，列表页需要自己实现手势。
 *      手势本身在 src/components/usePullRefresh.ts，这里只提供事件总线。
 *
 * 全部按需动态 import 插件：H5 产物里不会打进这两个包，也避免在桌面浏览器上
 * 触发「插件无 Web 实现」的运行时噪音。
 */
import { useEffect, useRef } from 'react'
import { IS_NATIVE, PLATFORM } from './platform'
import { registerPlugin } from '@capacitor/core'

export function isNativeApp(): boolean { return IS_NATIVE }

/* ------------------------------------------------------------------ *
 * 应用级刷新总线
 * ------------------------------------------------------------------ */

export type RefreshTask = () => void | Promise<void>

const refreshTasks = new Set<RefreshTask>()

/** 订阅一下拉刷新；返回取消订阅函数（组件卸载时必须调用） */
export function onAppRefresh(task: RefreshTask): () => void {
  refreshTasks.add(task)
  return () => {
    refreshTasks.delete(task)
  }
}

/** 广播一次刷新，等所有订阅者 settle 后 resolve（失败不阻断其余订阅者） */
export async function triggerAppRefresh(): Promise<void> {
  const running = Array.from(refreshTasks, async (task) => {
    try {
      await task()
    } catch (err) {
      console.error('[native] 下拉刷新订阅者执行失败', err)
    }
  })
  await Promise.all(running)
}

export function hasRefreshTask(): boolean {
  return refreshTasks.size > 0
}

/* ------------------------------------------------------------------ *
 * 返回键：拦截栈 + 统一决策
 * ------------------------------------------------------------------ */

/** 弹层返回拦截栈：后进先出，返回 true 表示本次返回键已被消费 */
const backInterceptors: Array<() => boolean> = []

/**
 * 注册一个返回键拦截器（一般用下面的 useBackInterceptor hook）。
 * 场景：底部抽屉打开时，返回键应先关抽屉而不是退页面。
 */
export function pushBackInterceptor(fn: () => boolean): () => void {
  backInterceptors.push(fn)
  return () => {
    const idx = backInterceptors.lastIndexOf(fn)
    if (idx >= 0) backInterceptors.splice(idx, 1)
  }
}

function runBackInterceptors(): boolean {
  for (let i = backInterceptors.length - 1; i >= 0; i -= 1) {
    try {
      if (backInterceptors[i]()) return true
    } catch (err) {
      console.error('[native] 返回键拦截器执行失败', err)
    }
  }
  return false
}

/** 弹层打开期间接管返回键：active 为 true 时返回键触发 onBack 并终止后续处理 */
export function useBackInterceptor(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack)
  latest.current = onBack

  useEffect(() => {
    if (!active || !IS_NATIVE) return undefined
    return pushBackInterceptor(() => {
      latest.current()
      return true
    })
  }, [active])
}

/**
 * 兜底关闭最上层抽屉。
 *
 * 现有 20 多个底部抽屉都是同一套写法：「全屏遮罩 + 点遮罩关闭」，逐个体检式加
 * 拦截钩子既费事又容易漏。抽屉贴底渲染、遮罩铺满全屏，所以从屏幕顶部取一个点：
 * 若该点落点不在页面滚动容器内（说明有遮罩盖在上面），就对它派发一次完整的
 * 按下序列，直接复用抽屉自己的关闭回调。
 *
 * 之所以要派发 mousedown/mouseup/click 三件套：存量抽屉的遮罩关法并不统一
 * （`sheet-mask` 走 onMouseDown，其他走 onClick），只发 click 会漏掉一批。
 *
 * 判定「是否真的关掉了」用节点是否已从文档移除，避免在不可关闭的浮层上误判成功
 * 而吞掉返回键。
 */
function closeTopOverlay(): boolean {
  if (typeof document === 'undefined') return false
  const page = document.querySelector('[data-app-page]')
  const x = Math.floor(window.innerWidth / 2)
  const y = Math.max(6, Math.floor(window.innerHeight * 0.05))
  const hit = document.elementFromPoint(x, y)

  if (!hit || hit === document.body || hit === document.documentElement) return false
  if (hit.id === 'boot-splash') return false
  if (page?.contains(hit)) return false

  const overlay = hit as HTMLElement
  /* 非交互节点（无关闭回调）点了也不会有反应，交给路由回退更合适 */
  if (typeof overlay.dispatchEvent !== 'function') return false

  const base = { bubbles: true, cancelable: true, view: window } as const
  overlay.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0 }))
  overlay.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0 }))
  overlay.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }))
  return !document.contains(overlay)
}

/** 退出/最小化应用：安卓按系统惯例先最小化（保留现场），其余平台直接退出 */
export async function leaveApp(): Promise<void> {
  if (!IS_NATIVE) return
  try {
    const { App } = await import('@capacitor/app')
    if (PLATFORM.os === 'android') await App.minimizeApp()
    else await App.exitApp()
  } catch (err) {
    console.error('[native] 退出应用失败', err)
  }
}

export interface BackDecisionOptions {
  /** 当前路由是否已在栈底（根 Tab 页） */
  isRoot: boolean
  /** 是否还有可回退的路由历史 */
  canGoBack: boolean
}

/**
 * 返回键统一决策链，顺序不可颠倒：
 *   1. 弹层拦截器（抽屉 / 收银台自己声明要接管）
 *   2. 兜底关闭最上层抽屉（覆盖未声明拦截器的存量抽屉）
 *   3. 路由回退
 *   4. 最小化（安卓）/ 退出（iOS）
 */
export function handleBack({ isRoot, canGoBack }: BackDecisionOptions): void {
  const focusDialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[data-focus-dialog][open]')).at(-1)
  if (focusDialog) {
    focusDialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    return
  }
  if (!window.dispatchEvent(new Event('app-overlay-back', { cancelable: true }))) return
  /* 番茄专注舱：禁止直接退路由，交给专注页确认并掉经验 */
  try {
    if (sessionStorage.getItem('pet.focus.immersive') === '1') {
      window.dispatchEvent(new CustomEvent('pet-focus-abort-request'))
      return
    }
  } catch {
    /* ignore */
  }
  if (runBackInterceptors()) return
  if (closeTopOverlay()) return
  // Study pages use the same parent-return policy as their visible back button.
  if (!window.dispatchEvent(new Event('app-study-back', { cancelable: true }))) return
  if (canGoBack && !isRoot) {
    /* 连续两次返回键：第一次正常回上一页，第二次由页面层接管回首页。 */
    if (!window.dispatchEvent(new Event('app-back-nav', { cancelable: true }))) return
    window.history.back()
    return
  }
  void leaveApp()
}

/* ------------------------------------------------------------------ *
 * 状态栏
 * ------------------------------------------------------------------ */

type NativeInsets = { top: number; bottom: number; left: number; right: number; keyboardHeight?: number }
const SafeArea = registerPlugin<{
  getInsets(): Promise<NativeInsets>
  addListener(event: 'insetsChanged', listener: (insets: NativeInsets) => void): Promise<{ remove(): Promise<void> }>
}>('SafeArea')
let insetsBound = false

function applyInsets(insets: NativeInsets) {
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const value = insets[side]
    if (Number.isFinite(value) && value >= 0)
      document.documentElement.style.setProperty(`--safe-${side}`, `${value}px`)
  }
  const keyboardHeight = insets.keyboardHeight
  if (Number.isFinite(keyboardHeight) && keyboardHeight! >= 0) {
    document.documentElement.style.setProperty('--native-ime-inset', `${keyboardHeight}px`)
    window.dispatchEvent(new Event('app-native-insets'))
  }
}

async function bindSafeArea(): Promise<void> {
  if (PLATFORM.os !== 'android') return
  if (!insetsBound) {
    await SafeArea.addListener('insetsChanged', applyInsets)
    insetsBound = true
  }
  applyInsets(await SafeArea.getInsets())
}

/** Capacitor LIGHT means dark icons; DARK means light icons. */
export async function syncNativeTheme(dark = document.documentElement.dataset.theme === 'dark'): Promise<void> {
  if (!IS_NATIVE) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    document.documentElement.style.setProperty('--status-bar-bg', dark ? '#16211a' : '#f5f8f5')
  } catch (error) { console.error('[native] 状态栏主题更新失败', error) }
}

async function applyStatusBar(): Promise<void> {
  const { StatusBar } = await import('@capacitor/status-bar')
  await syncNativeTheme()

  if (PLATFORM.os !== 'android') return
  /* 安卓：让 WebView 延伸到状态栏下方（沉浸），背景透明后由页面底色透上来 */
  await StatusBar.setOverlaysWebView({ overlay: true })
  await StatusBar.setBackgroundColor({ color: '#00000000' })
  // WindowInsets is the only Android source; native margins remain disabled.
  await bindSafeArea()
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

let statusBarStarted: Promise<void> | null = null

/**
 * 应用状态栏配置（幂等）。刻意与 React 解耦：在 main.tsx 渲染前就调用，
 * 让状态栏在启动屏阶段就已经是沉浸 + 深色图标，避免第一帧出现黑条闪一下。
 */
export function applyNativeStatusBar(): Promise<void> {
  if (!IS_NATIVE) return Promise.resolve()
  if (!statusBarStarted) {
    statusBarStarted = applyStatusBar().catch((err) => {
      console.error('[native] 状态栏初始化失败', err)
      statusBarStarted = null
    })
  }
  return statusBarStarted
}

let backBound = false

/**
 * 接管安卓硬件返回键（幂等）。
 *
 * @param isRootRoute 读当前路由是否已在栈底（根 Tab 页）。用函数透传是为了让
 *   Router 里的最新 location 能被原生事件读到，而事件监听只注册一次。
 */
export async function bindBackButton(isRootRoute: () => boolean): Promise<void> {
  if (!IS_NATIVE || backBound) return
  backBound = true
  try {
    const { App } = await import('@capacitor/app')
    /* 一旦注册监听，Capacitor 默认的「直接关 Activity」行为即被关闭 */
    await App.addListener('backButton', ({ canGoBack }) => {
      handleBack({ isRoot: isRootRoute(), canGoBack })
    })
  } catch (err) {
    backBound = false
    console.error('[native] 返回键接管失败', err)
  }
}

/** 启动原生壳：状态栏 + 返回键，可重复调用 */
export async function initNativeShell(isRootRoute: () => boolean): Promise<void> {
  await Promise.all([applyNativeStatusBar(), bindBackButton(isRootRoute)])
}
