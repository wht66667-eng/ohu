/**
 * 注入教务 / WebVPN 页：检测到学生主页或课表页后，通知后台自动同步。
 * 不读取页面 Cookie（HttpOnly 读不到）；真正取 Cookie 在 background 的 chrome.cookies。
 */
(function () {
  const href = String(location.href || '')
  const ready =
    /xs_main\.aspx/i.test(href) ||
    /xskbcx/i.test(href) ||
    /欢迎您/.test(document.body ? document.body.innerText.slice(0, 2000) : '')

  if (!ready) return

  // 给页面角标提示（轻量，不挡操作）
  try {
    if (!document.getElementById('jou-tt-sync-tip')) {
      const tip = document.createElement('div')
      tip.id = 'jou-tt-sync-tip'
      tip.textContent = '阳光课表：已检测到登录，正在自动同步…'
      tip.style.cssText =
        'position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:240px;padding:10px 12px;border-radius:12px;background:#1d150e;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);'
      document.documentElement.appendChild(tip)
      setTimeout(() => tip.remove(), 5000)
    }
  } catch (_) {}

  chrome.runtime.sendMessage({ type: 'JW_READY', url: href }, () => void chrome.runtime.lastError)
})()
