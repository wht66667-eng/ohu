/**
 * 海大课表一键同步
 *
 * 你只需两步登录：
 *   1) 登录 WebVPN
 *   2) 登录教务（学号密码）
 * 其余全自动：VPN 登录后跳转教务 → 教务登录后爬课表 → 写入永久课表界面
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import {
  guessTerm,
  rowsToTable,
  toWakeUpCsv,
  walkJouDayRowSchedule,
} from './parse-jou-html.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
/** 站内应用根（xm-main）：并入 tools/ 后，产物要落回应用的 public/ */
const APP_ROOT = path.resolve(ROOT, '..', '..')
const DESKTOP = path.join(os.homedir(), 'Desktop')

const VPN_URL = process.env.JW_WEBVPN_URL || 'http://webvpn.jou.edu.cn:58888/'
const JW_DIRECT = process.env.JW_BASE_URL || 'https://zfxk.jou.edu.cn'
/** WebVPN 下已验证可用的教务入口（网瑞达包裹路径） */
const JW_WEBVPN =
  process.env.JW_WEBVPN_JW ||
  'http://webvpn.jou.edu.cn:58888/https/77726476706e69737468656265737421eaf15997693a6745300d8db9d6562d/'
const H5_URL = process.env.H5_URL || 'http://localhost:43123/'
const PROFILE = path.join(os.homedir(), '.jou-timetable-browser')

function log(...args) {
  console.log('[课表同步]', ...args)
}

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.EDGE_PATH
  if (env && fs.existsSync(env)) return env
  const local = process.env.LOCALAPPDATA || ''
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
  const candidates = [
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return ''
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isVpnPortal(url) {
  const u = String(url || '')
  return /webvpn\.jou\.edu\.cn/i.test(u) && !/\/https\/|\/http\//i.test(u)
}

function isJwPage(url) {
  const u = String(url || '')
  return /zfxk\.jou\.edu\.cn/i.test(u) || (/webvpn\.jou\.edu\.cn/i.test(u) && /\/https\/|\/http\//i.test(u))
}

function isJwLoggedIn(url, title = '', text = '') {
  return (
    /xs_main\.aspx|content_xs\.aspx|xskbcx/i.test(url) ||
    /欢迎您/.test(title) ||
    /欢迎您/.test(text)
  )
}

function isVpnLoggedIn(url, text = '') {
  // 登录后资源门户：有自定义跳转 / 资源列表，且不再是纯登录页
  if (!/webvpn\.jou\.edu\.cn/i.test(url)) return false
  if (/login|auth|cas/i.test(url) && !/portal|resource|index/i.test(url)) {
    // 可能仍是登录页
  }
  return /自定义|资源|门户|教务|图书馆|跳转/.test(text) || (/webvpn/i.test(url) && !/password|passwd|验证码/.test(text.slice(0, 800)))
}

async function pageText(page) {
  try {
    return await page.evaluate(() => (document.body ? document.body.innerText : ''))
  } catch {
    return ''
  }
}

async function ensureH5Running() {
  try {
    const r = await fetch(H5_URL)
    if (r.ok) return true
  } catch (_) {}
  log('启动永久课表界面…')
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: APP_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  for (let i = 0; i < 40; i++) {
    await sleep(800)
    try {
      const r = await fetch(H5_URL)
      if (r.ok) return true
    } catch (_) {}
  }
  return false
}

/** 阶段1：等 VPN 登录成功，然后自动跳教务 */
async function stageVpnThenJumpJw(page, timeoutMs = 12 * 60 * 1000) {
  log('① 请登录学校 WebVPN（学号 / 校园网账号）')
  const start = Date.now()
  let jumped = false

  while (Date.now() - start < timeoutMs) {
    const url = page.url()
    const text = await pageText(page)

    // 已经在教务（含 WebVPN 包裹）
    if (isJwPage(url)) {
      log('已进入教务入口：', url)
      return { ok: true }
    }

    // VPN 门户已登录 → 自动跳教务
    if (isVpnPortal(url) && (isVpnLoggedIn(url, text) || /教务|zfxk|资源/.test(text))) {
      if (!jumped) {
        jumped = true
        log('VPN 已登录，正在自动跳转教务系统…')
        const jumpedOk = await jumpToJw(page)
        if (jumpedOk) {
          await sleep(1500)
          continue
        }
      }
    }

    // 直接检测「欢迎您」说明已登录教务
    if (isJwLoggedIn(url, await page.title().catch(() => ''), text)) {
      return { ok: true }
    }

    await sleep(1200)
  }
  return { ok: false, reason: 'vpn-timeout' }
}

async function jumpToJw(page) {
  // 1) 点资源列表里的「教务」
  try {
    const clicked = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('a, button, span, div')]
      const hit = nodes.find((el) => {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, '')
        return /教务管理|教务系统|正方教务|教务在线/.test(t) && t.length < 30
      })
      if (hit) {
        hit.click()
        return true
      }
      return false
    })
    if (clicked) {
      await sleep(2000)
      if (isJwPage(page.url())) return true
    }
  } catch (_) {}

  // 2) 自定义跳转框填入 zfxk
  try {
    const filled = await page.evaluate((jw) => {
      const inputs = [...document.querySelectorAll('input, textarea')]
      const box =
        inputs.find((i) => /url|地址|跳转|host|target/i.test(i.name + i.id + i.placeholder + i.className)) ||
        inputs.find((i) => i.type === 'text' || !i.type)
      if (!box) return false
      box.focus()
      box.value = jw
      box.dispatchEvent(new Event('input', { bubbles: true }))
      box.dispatchEvent(new Event('change', { bubbles: true }))
      const btn = [...document.querySelectorAll('button, a, input[type=button], input[type=submit]')].find((el) =>
        /跳转|访问|go|GO|打开/.test(el.innerText || el.value || ''),
      )
      if (btn) btn.click()
      else {
        const form = box.closest('form')
        if (form) form.submit()
        else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      }
      return true
    }, 'http://zfxk.jou.edu.cn')
    if (filled) {
      await sleep(2500)
      if (isJwPage(page.url())) return true
    }
  } catch (_) {}

  // 3) 已知 WebVPN 包裹地址硬跳
  try {
    await page.goto(JW_WEBVPN + 'default2.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 })
    return true
  } catch (_) {}
  try {
    await page.goto(JW_WEBVPN, { waitUntil: 'domcontentloaded', timeout: 30000 })
    return true
  } catch (_) {}
  return false
}

/** 阶段2：等教务登录成功 */
async function stageJwLogin(page, timeoutMs = 12 * 60 * 1000) {
  log('② 请登录教务系统（学号 + 密码 + 验证码），看到「欢迎您」即可')
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pages = await page.browser().pages()
    for (const p of pages) {
      const url = p.url()
      const title = await p.title().catch(() => '')
      const text = await pageText(p)
      if (isJwLoggedIn(url, title, text)) {
        log('教务已登录：', url)
        return { ok: true, page: p, url }
      }
    }
    // 若还停在 VPN 门户，再试一次跳转
    if (isVpnPortal(page.url())) {
      await jumpToJw(page)
    }
    await sleep(1200)
  }
  return { ok: false }
}

async function collectScheduleHtml(active) {
  const chunks = []
  const push = (s) => {
    if (s && s.length > 50) chunks.push(s)
  }

  try {
    push(await active.content())
  } catch (_) {}

  // 关键：首页课表在 iframe#iframeautoheight / name=zhuti → content_xs.aspx
  try {
    for (const f of active.frames()) {
      const fu = f.url()
      try {
        const html = await f.content()
        push(html)
        if (/Table6|kblsbk|content_xs/i.test(html) || /content_xs|Table6/i.test(fu)) {
          log('命中课表 frame：', fu || '(about)')
        }
      } catch (_) {}
    }
  } catch (_) {}

  // 若当前是 xs_main，主动打开 content_xs（带 xh）
  try {
    const url = active.url()
    const xh = new URL(url).searchParams.get('xh') || ''
    if (/xs_main\.aspx/i.test(url)) {
      const next = url.replace(/xs_main\.aspx/i, 'content_xs.aspx')
      log('打开首页课表页：', next)
      await active.goto(next, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await sleep(1200)
      push(await active.content())
      for (const f of active.frames()) {
        try {
          push(await f.content())
        } catch (_) {}
      }
    }
    // 再试 xskbcx
    if (xh || /webvpn|zfxk/i.test(url)) {
      const kb = url.replace(/\/(?:xs_main|content_xs|xskbcx|default2)\.aspx.*/i, `/xskbcx.aspx${xh ? `?xh=${xh}` : ''}`)
      if (kb !== url) {
        try {
          await active.goto(kb, { waitUntil: 'domcontentloaded', timeout: 25000 })
          await sleep(1000)
          push(await active.content())
        } catch (_) {}
      }
    }
  } catch (_) {}

  const all = chunks.join('\n\n<!--PAGE-->\n\n')
  try {
    fs.writeFileSync(path.join(DESKTOP, '海大课表-抓取调试.html'), all.slice(0, 2_500_000), 'utf8')
  } catch (_) {}
  return all
}

function writeDesktopFiles(table, rows, term) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const payload = { term, savedAt: new Date().toISOString(), table, rows }
  const latestJson = path.join(DESKTOP, '海大课表-最新.json')
  const latestCsv = path.join(DESKTOP, '海大课表-WakeUp-最新.csv')
  fs.writeFileSync(path.join(DESKTOP, `海大课表-${stamp}.json`), JSON.stringify(payload, null, 2), 'utf8')
  fs.writeFileSync(latestJson, JSON.stringify(payload, null, 2), 'utf8')
  const csv = '\uFEFF' + toWakeUpCsv(table)
  fs.writeFileSync(path.join(DESKTOP, `海大课表-WakeUp-${stamp}.csv`), csv, 'utf8')
  fs.writeFileSync(latestCsv, csv, 'utf8')
  // 供课表页认领：落回应用 public/，页面启动或 ?sync=1 时读取并写入账号存储
  try {
    const pub = path.join(APP_ROOT, 'public')
    fs.mkdirSync(pub, { recursive: true })
    fs.writeFileSync(path.join(pub, 'last-snapshot.json'), JSON.stringify(payload, null, 2), 'utf8')
  } catch (_) {}
  log('已写到桌面：海大课表-最新.json / 海大课表-WakeUp-最新.csv')
  return { latestJson, latestCsv }
}

async function writePermanentUi(browser, table, rows, term) {
  // 落盘后用带 ?sync=1 的地址打开，页面会读 public/last-snapshot.json 写入永久存储
  void table
  void rows
  void term
  const ok = await ensureH5Running()
  if (!ok) {
    log(`课表界面未能启动，但桌面 JSON 已保存，可稍后打开 ${H5_URL}?sync=1`)
    return false
  }
  const page = await browser.newPage()
  await page.goto(H5_URL + '?sync=1', { waitUntil: 'domcontentloaded', timeout: 30000 })
  log('永久课表界面已打开：', H5_URL + '?sync=1')
  return true
}

async function main() {
  const exe = findBrowser()
  if (!exe) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }
  log('浏览器：', exe)
  await ensureH5Running()
  fs.mkdirSync(PROFILE, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: false,
    defaultViewport: null,
    userDataDir: PROFILE,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  })

  const page = (await browser.pages())[0] || (await browser.newPage())
  await page.goto(VPN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

  const vpn = await stageVpnThenJumpJw(page)
  if (!vpn.ok) {
    log('WebVPN 登录超时')
    process.exit(2)
  }

  const jw = await stageJwLogin(page)
  if (!jw.ok) {
    log('教务登录超时')
    process.exit(3)
  }

  const active = jw.page || page
  log('③ 正在爬取课表…')
  const html = await collectScheduleHtml(active)
  const rows = walkJouDayRowSchedule(html)
  const term = guessTerm(html)

  if (!rows?.length) {
    log('未解析到课表。调试文件已写到桌面：海大课表-抓取调试.html')
    process.exit(5)
  }

  const table = rowsToTable(rows, term)
  const names = [...new Set(table.courses.map((c) => c.name))]
  log(`成功：${names.length} 门课 / ${rows.length} 条安排`)
  log('课程：', names.join('、'))

  writeDesktopFiles(table, rows, term)
  await writePermanentUi(browser, table, rows, term)
  log('全部完成。课表已写入课表页（已登录同步到账号，未登录存本机），下次打开仍在。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
