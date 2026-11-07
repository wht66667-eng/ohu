/** Share the public product page, never the current route or any account parameters. */
export const OHU_SHARE_URL = 'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/download/index.html'

export async function shareOhuLink(): Promise<string> {
  if (navigator.share) {
    try {
      await navigator.share({ title: '哦狐', text: '和哦狐一起探索校园生活', url: OHU_SHARE_URL })
      return '系统分享已完成。'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return '已取消分享。'
    }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(OHU_SHARE_URL); return '官网链接已复制，可以粘贴给同学。' } catch { /* Offer manual copying when clipboard access is blocked. */ }
  }
  const shown = window.prompt('复制哦狐官网链接', OHU_SHARE_URL)
  return shown === null ? '已取消分享。' : '官网链接已显示，请手动复制。'
}
