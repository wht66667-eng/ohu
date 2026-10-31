import { Capacitor, registerPlugin } from '@capacitor/core'

const gallery = registerPlugin<{ save: (args: { data: string }) => Promise<void> }>('ShareGallery')

/** Save PNG share art using the platform's real capability and report what happened. */
export async function saveShareImage(data: string, filename: string): Promise<string> {
  if (!data.startsWith('data:image/png;base64,')) throw new Error('分享图片格式不正确，请重新生成。')

  if (Capacitor.getPlatform() === 'android') {
    if (!Capacitor.isPluginAvailable('ShareGallery')) {
      throw new Error('当前安卓安装包没有相册保存能力，请更新安装包后再保存。')
    }
    await gallery.save({ data })
    return '已保存到相册，图片位于 Ohhu 相册。'
  }

  if (Capacitor.getPlatform() === 'ios') {
    if (!navigator.share || !navigator.canShare) throw new Error('当前 iPhone 系统不支持分享图片，请更新系统或在 Safari 中打开。')
    const encoded = data.slice('data:image/png;base64,'.length)
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    const file = new File([bytes], filename, { type: 'image/png' })
    if (!navigator.canShare({ files: [file] })) throw new Error('系统分享面板暂不支持图片文件；可在 Safari 中打开后保存。')
    try {
      await navigator.share({ title: '哦狐分享卡', files: [file] })
      return '系统分享已完成；要存入照片，请在面板中选择“存储图像”。'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('已取消系统分享；分享图仍保留，可以重试。')
      throw new Error('系统分享未能打开，请在 Safari 中打开后重试。')
    }
  }

  if (Capacitor.isNativePlatform()) {
    throw new Error('当前安装包暂不支持直接保存到相册，请在浏览器中打开后保存。')
  }

  const anchor = document.createElement('a')
  anchor.href = data
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return '已发起图片下载；微信内可长按图片保存。'
}
