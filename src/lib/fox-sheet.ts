/** Windows into the two transparent OHU mascot sheets supplied by the designer. */
export const FOX_SHEETS = {
  actions: '/brand/ohu-original/fox-actions-sheet.png',
  emotions: '/brand/ohu-original/fox-emotions-sheet.png',
} as const

type Sheet = keyof typeof FOX_SHEETS
export const FOX_SHEET_SIZE = 1254
type ClipPoint = readonly [number, number]
type Pose = { sheet: Sheet; x: number; y: number; width: number; height: number; label: string; clipPath?: readonly ClipPoint[] }

export const FOX_POSES = {
  reading: { sheet: 'actions', x: 12, y: 6, width: 344, height: 328, label: '阿狐读书' },
  studying: { sheet: 'actions', x: 360, y: 8, width: 445, height: 315, label: '阿狐学习' },
  waving: { sheet: 'actions', x: 820, y: 3, width: 415, height: 340, label: '阿狐挥手' },
  tea: { sheet: 'actions', x: 10, y: 332, width: 335, height: 302, label: '阿狐喝茶' },
  phone: { sheet: 'actions', x: 348, y: 330, width: 340, height: 297, label: '阿狐看手机' },
  cheering: { sheet: 'actions', x: 690, y: 338, width: 285, height: 290, label: '阿狐加油', clipPath: [[0,0],[285,0],[285,180],[277,240],[267,290],[0,290]] },
  walking: { sheet: 'actions', x: 974, y: 338, width: 275, height: 317, label: '阿狐出发', clipPath: [[0,0],[275,0],[275,317],[165,317],[163,304],[105,301],[90,292],[0,292]] },
  map: { sheet: 'actions', x: 18, y: 626, width: 380, height: 296, label: '阿狐看地图' },
  writing: { sheet: 'actions', x: 790, y: 630, width: 454, height: 305, label: '阿狐写字', clipPath: [[0,35],[100,35],[135,20],[175,0],[335,0],[335,26],[454,45],[454,305],[0,305]] },
  thinking: { sheet: 'actions', x: 34, y: 916, width: 355, height: 332, label: '阿狐思考' },
  resting: { sheet: 'actions', x: 394, y: 956, width: 440, height: 282, label: '阿狐休息' },
  yay: { sheet: 'actions', x: 836, y: 930, width: 405, height: 310, label: '阿狐庆祝' },
  cool: { sheet: 'emotions', x: 313, y: 448, width: 335, height: 332, label: '酷酷的阿狐', clipPath: [[0,0],[335,0],[335,182],[297,192],[297,332],[0,332]] },
  sleepy: { sheet: 'emotions', x: 613, y: 448, width: 360, height: 335, label: '阿狐睡着了', clipPath: [[37,0],[360,0],[360,335],[0,335],[0,202],[7,190],[27,182],[37,172]] },
  surprised: { sheet: 'emotions', x: 944, y: 88, width: 305, height: 348, label: '阿狐惊讶' },
  love: { sheet: 'emotions', x: 623, y: 842, width: 321, height: 334, label: '阿狐爱心' },
  thumbs: { sheet: 'emotions', x: 932, y: 836, width: 318, height: 346, label: '阿狐点赞', clipPath: [[0,0],[318,0],[318,346],[12,346],[12,185],[0,130]] },
} as const satisfies Record<string, Pose>

export type FoxPoseId = keyof typeof FOX_POSES

/** One crop contract for SVG display, native map markup and exported PNG files. */
export function foxPoseClip(id: FoxPoseId): readonly ClipPoint[] {
  const pose: Pose = FOX_POSES[id]
  return pose.clipPath || [[0,0],[pose.width,0],[pose.width,pose.height],[0,pose.height]]
}
export function foxPoseClipPoints(id: FoxPoseId): string { return foxPoseClip(id).map(point => point.join(',')).join(' ') }
export function foxPoseSvgMarkup(id: FoxPoseId, clipId: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(clipId)) throw new Error('阿狐裁切标识无效')
  const pose = FOX_POSES[id]
  return `<svg viewBox="0 0 ${pose.width} ${pose.height}" aria-hidden="true"><defs><clipPath id="${clipId}"><polygon points="${foxPoseClipPoints(id)}"/></clipPath></defs><g clip-path="url(#${clipId})"><image href="${FOX_SHEETS[pose.sheet]}" x="${-pose.x}" y="${-pose.y}" width="${FOX_SHEET_SIZE}" height="${FOX_SHEET_SIZE}"/></g></svg>`
}

/** Keep historical engagement keys while presenting the current supplied mascot library. */
export const FOX_CODEX_POSES: Readonly<Record<string, FoxPoseId>> = {
  default: 'waving', away_2: 'thinking', away_5: 'reading', away_8: 'studying',
  away_12: 'resting', away_15: 'tea', away_20: 'sleepy', away_25: 'surprised', away_30: 'phone',
  streak_1: 'yay', streak_3: 'cheering', streak_7: 'thumbs', streak_14: 'cool',
}
export function foxPoseForState(state?: string): FoxPoseId { return FOX_CODEX_POSES[state || 'default'] || FOX_CODEX_POSES.default }

/** Export an isolated transparent PNG only when the user chooses an avatar or sends a sticker. */
export async function foxPoseFile(id: FoxPoseId): Promise<File> {
  const pose = FOX_POSES[id]
  const img = new Image()
  img.src = FOX_SHEETS[pose.sheet]
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = pose.width
  canvas.height = pose.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法处理阿狐图片')
  const points = foxPoseClip(id)
  ctx.beginPath()
  points.forEach(([x,y], index) => index === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y))
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, pose.x, pose.y, pose.width, pose.height, 0, 0, pose.width, pose.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('无法保存阿狐图片')
  return new File([blob], `ohu-fox-${id}.png`, { type: 'image/png' })
}
