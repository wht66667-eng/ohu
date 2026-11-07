export const MOMENT_FONTS = [
  { id: 'system', label: '系统黑体', family: 'sans-serif' },
  { id: 'serif', label: '系统宋体', family: 'serif' },
  { id: 'zcoolkuaile', label: '站酷快乐体', family: 'OhuZcoolKuaiLe' },
  { id: 'zcoolxiaowei', label: '站酷小薇体', family: 'OhuZcoolXiaoWei' },
  { id: 'longcang', label: '龙藏手书', family: 'OhuLongCang' },
] as const
const loading = new Map<string, Promise<void>>()

/** 字库随包分发，只有用户选用时才解码，不从第三方CDN获取照片或字体。 */
export async function loadMomentFont(family: string): Promise<void> {
  const font = MOMENT_FONTS.find(item => item.family === family)
  if (!font || font.id === 'system' || font.id === 'serif') return
  if (!loading.has(family)) {
    loading.set(family, (async () => {
      const face = new FontFace(family, `url("${import.meta.env.BASE_URL}moment-editor/fonts/${font.id}/font.woff2")`)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([face.load(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('字体加载超时')), 15000) })]); document.fonts.add(face) }
      finally { clearTimeout(timeout) }
    })().catch(() => { loading.delete(family); throw new Error('字体加载失败，请重试或选择系统字体。') }))
  }
  await loading.get(family)
}

/** 撤销和重新打开编辑器前恢复字库，避免导出时静默回退到另一种字形。 */
export async function loadSnapshotFonts(json: string): Promise<void> {
  const value = JSON.parse(json) as { objects?: Array<{ fontFamily?: string }> }
  await Promise.all([...new Set((value.objects || []).map(item => item.fontFamily).filter((item): item is string => !!item))].map(loadMomentFont))
}
