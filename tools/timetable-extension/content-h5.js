/** 注入校园 H5：接收扩展推送的 Cookie 并转成页面可监听的 postMessage */
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'TT_COOKIES' || !msg.cookie) return
  const data = {
    source: 'jou-tt-sync',
    type: 'TT_COOKIES',
    cookie: msg.cookie,
    url: msg.url || '',
    auto: !!msg.auto,
    t: msg.t || Date.now(),
  }
  try {
    sessionStorage.setItem('jou_tt_sync_payload', JSON.stringify(data))
  } catch (_) {}
  window.postMessage(data, '*')
})

// 页面加载时若已有待处理载荷，再广播一次（扩展先写入、后跳转的情况）
try {
  const raw = sessionStorage.getItem('jou_tt_sync_payload')
  if (raw) {
    const data = JSON.parse(raw)
    if (data && data.cookie) {
      setTimeout(() => window.postMessage(data, '*'), 50)
    }
  }
} catch (_) {}
