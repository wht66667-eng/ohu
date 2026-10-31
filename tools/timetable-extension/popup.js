const go = document.getElementById('go')
const msg = document.getElementById('msg')
const h5 = document.getElementById('h5')

chrome.storage.sync.get(['h5Base']).then((s) => {
    h5.value = s.h5Base || 'http://localhost:43123'
})

h5.addEventListener('change', () => {
  const v = h5.value.trim().replace(/\/+$/, '')
  void chrome.storage.sync.set({ h5Base: v || 'http://localhost:43123' })
})

go.addEventListener('click', async () => {
  go.disabled = true
  msg.className = 'msg'
  msg.textContent = '正在读取 Cookie 并同步…'
  const base = h5.value.trim().replace(/\/+$/, '')
  if (base) await chrome.storage.sync.set({ h5Base: base })
  chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, (r) => {
    go.disabled = false
    if (chrome.runtime.lastError) {
      msg.className = 'msg err'
      msg.textContent = chrome.runtime.lastError.message || '扩展通信失败'
      return
    }
    if (r && r.ok) {
      msg.className = 'msg ok'
      msg.textContent = '已发送到课表页，请查看导入结果。'
    } else {
      msg.className = 'msg err'
      msg.textContent = (r && r.error) || '同步失败'
    }
  })
})
