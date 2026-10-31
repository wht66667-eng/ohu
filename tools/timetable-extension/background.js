/**
 * 阳光课表同步 · 后台
 * 在 WebVPN / 教务域读取含 HttpOnly 的 Cookie，推到校园 H5 课表页自动导入。
 */

const H5_CANDIDATES = [
  'http://localhost:43123/schedule',
  'http://127.0.0.1:43123/schedule',
  'http://localhost:43123/',
  'http://127.0.0.1:43123/',
]

const JW_HOST_RE = /(^|\.)jou\.edu\.cn$/i
const SUCCESS_PATH_RE = /xs_main\.aspx|xskbcx|kbcx/i

function cookieHeader(list) {
  const map = new Map()
  for (const c of list) {
    if (!c || !c.name) continue
    // 同名以后写覆盖（WebVPN 与教务偶发同名时保留最新）
    map.set(c.name, c.value)
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function collectJouCookies() {
  const byUrl = await Promise.all([
    chrome.cookies.getAll({ url: 'https://zfxk.jou.edu.cn/' }),
    chrome.cookies.getAll({ url: 'http://webvpn.jou.edu.cn:58888/' }),
    chrome.cookies.getAll({ url: 'http://webvpn.jou.edu.cn/' }),
    chrome.cookies.getAll({ url: 'https://webvpn.jou.edu.cn/' }),
  ])
  const byDomain = await Promise.all([
    chrome.cookies.getAll({ domain: 'jou.edu.cn' }),
    chrome.cookies.getAll({ domain: 'zfxk.jou.edu.cn' }),
    chrome.cookies.getAll({ domain: 'webvpn.jou.edu.cn' }),
  ])
  const all = [...byUrl.flat(), ...byDomain.flat()]
  return cookieHeader(all)
}

async function findJwTabUrl() {
  const tabs = await chrome.tabs.query({})
  for (const t of tabs) {
    if (!t.url) continue
    try {
      const u = new URL(t.url)
      if (JW_HOST_RE.test(u.hostname) && SUCCESS_PATH_RE.test(u.pathname + u.search)) {
        return t.url
      }
    } catch (_) {}
  }
  for (const t of tabs) {
    if (!t.url) continue
    try {
      const u = new URL(t.url)
      if (u.hostname.includes('zfxk.jou.edu.cn') || /webvpn.*jou/.test(u.hostname)) {
        return t.url
      }
    } catch (_) {}
  }
  return ''
}

async function resolveH5Base() {
  const { h5Base } = await chrome.storage.sync.get(['h5Base'])
  if (h5Base && typeof h5Base === 'string' && /^https?:\/\//i.test(h5Base)) {
    return h5Base.replace(/\/+$/, '')
  }
  // 优先已打开的课表页（站内端口 43123，或路径含 /schedule）
  const tabs = await chrome.tabs.query({})
  for (const t of tabs) {
    if (!t.url) continue
    if (!/(localhost|127\.0\.0\.1|tcloudbase|cloudstudio)/i.test(t.url)) continue
    if (/:43123\b|\/schedule\b|jou-timetable/i.test(t.url)) {
      try {
        return new URL(t.url).origin
      } catch (_) {}
    }
  }
  return new URL(H5_CANDIDATES[0]).origin
}

async function pushToH5({ cookie, pageUrl, auto }) {
  if (!cookie || cookie.length < 8) {
    return { ok: false, error: '未读到教务 Cookie：请先在本浏览器登录 WebVPN，再登录教务系统。' }
  }
  const origin = await resolveH5Base()
  // 课表页固定在站内 /schedule
  const target = `${origin}/schedule`
  const payload = {
    source: 'jou-tt-sync',
    type: 'TT_COOKIES',
    cookie,
    url: pageUrl || '',
    auto: !!auto,
    t: Date.now(),
  }

  let tab = (await chrome.tabs.query({ url: [`${origin}/*`] }))[0]
  if (!tab) {
    tab = await chrome.tabs.create({ url: target, active: true })
    // 等内容脚本就绪
    await new Promise((r) => setTimeout(r, 1200))
  } else {
    await chrome.tabs.update(tab.id, { active: true })
    await new Promise((r) => setTimeout(r, 400))
  }

  try {
    await chrome.tabs.sendMessage(tab.id, payload)
  } catch (_) {
    // 内容脚本未注入时，用 scripting 兜底写入 sessionStorage
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (data) => {
          try {
            sessionStorage.setItem('jou_tt_sync_payload', JSON.stringify(data))
          } catch (_) {}
          window.postMessage(data, '*')
        },
        args: [payload],
      })
    } catch (e) {
      return { ok: false, error: '已打开课表页，但无法注入：请刷新课表页后再点同步。' }
    }
  }

  try {
    chrome.notifications.create(`tt-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: '阳光课表',
      message: auto ? '已检测到教务登录，正在同步课表…' : 'Cookie 已发送，正在导入课表…',
      priority: 1,
    })
  } catch (_) {}

  return { ok: true }
}

async function syncNow(auto) {
  const cookie = await collectJouCookies()
  const pageUrl = await findJwTabUrl()
  return pushToH5({ cookie, pageUrl, auto })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'SYNC_NOW') {
    syncNow(false).then(sendResponse)
    return true
  }
  if (msg && msg.type === 'JW_READY') {
    // 教务页探测到已登录：自动同步（带轻微防抖）
    chrome.storage.session.get(['lastAuto']).then(async (s) => {
      const now = Date.now()
      if (s.lastAuto && now - s.lastAuto < 15000) {
        sendResponse({ ok: true, skipped: true })
        return
      }
      await chrome.storage.session.set({ lastAuto: now })
      const r = await syncNow(true)
      sendResponse(r)
    })
    return true
  }
  return false
})

// 点击扩展图标（无 popup 时）也可同步；有 popup 则由 popup 触发
chrome.action.onClicked.addListener(() => {
  void syncNow(false)
})
