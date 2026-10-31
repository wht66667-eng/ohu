/** First-release assets only. Milestones describe the artwork; they never lock the picker. */
type FoxV1Asset = {
  id: string
  file: string
  name: string
  caption: string
  category: 'login' | 'missed' | 'random' | 'hidden'
  threshold: number | null
}

export const FOX_V1_STICKERS = [
  { id: 'login_day_01', file: '01_login_day_01.png', name: '连续登录第1天', caption: '你终于来啦！', category: 'login', threshold: 1 },
  { id: 'login_day_03', file: '02_login_day_03.png', name: '连续登录第3天', caption: '三天！阿狐要飘了！', category: 'login', threshold: 3 },
  { id: 'login_day_07', file: '03_login_day_07.png', name: '连续登录第7天', caption: '连续七天！我疯啦！', category: 'login', threshold: 7 },
  { id: 'login_day_30', file: '04_login_day_30.png', name: '连续登录第30天', caption: '三十天！给朕鼓掌！', category: 'login', threshold: 30 },
  { id: 'miss_day_01', file: '05_miss_day_01.png', name: '未登录第1天', caption: '你昨天去哪儿了？', category: 'missed', threshold: 1 },
  { id: 'miss_day_02', file: '06_miss_day_02.png', name: '未登录第2天', caption: '我是不是被卸载了？', category: 'missed', threshold: 2 },
  { id: 'miss_day_03', file: '07_miss_day_03.png', name: '未登录第3天', caption: '我芽都等蔫了！', category: 'missed', threshold: 3 },
  { id: 'miss_day_07', file: '08_miss_day_07.png', name: '未登录第7天', caption: '七天了！整整七天！', category: 'missed', threshold: 7 },
  { id: 'miss_day_15', file: '09_miss_day_15.png', name: '未登录第15天', caption: '终于想起我了？', category: 'missed', threshold: 15 },
  { id: 'miss_day_30', file: '10_miss_day_30.png', name: '未登录第30天', caption: '我等到融化了！', category: 'missed', threshold: 30 },
  { id: 'random_stare', file: '11_random_stare.png', name: '死亡凝视狐', caption: '我就静静看着你。', category: 'random', threshold: null },
  { id: 'random_sarcasm', file: '12_random_sarcasm.png', name: '阴阳怪气狐', caption: '哟，稀客呀～', category: 'random', threshold: null },
  { id: 'random_chaos', file: '13_random_chaos.png', name: '精神错乱狐', caption: '哈哈哈哈……哈？', category: 'random', threshold: null },
  { id: 'random_study', file: '14_random_study.png', name: '监督学习狐', caption: '书呢？打开！', category: 'random', threshold: null },
  { id: 'hidden_school', file: '15_hidden_school.png', name: '开学发疯狐', caption: '怎么又开学了啊啊啊！', category: 'hidden', threshold: null },
  { id: 'hidden_exam', file: '16_hidden_exam.png', name: '期末渡劫狐', caption: '知识它不进脑子啊！', category: 'hidden', threshold: null },
] as const satisfies readonly FoxV1Asset[]

export type FoxV1Sticker = typeof FOX_V1_STICKERS[number]
export type FoxV1StickerId = FoxV1Sticker['id']

export function foxV1StickerUrl(sticker: FoxV1Sticker | FoxV1StickerId): string {
  const item = typeof sticker === 'string' ? FOX_V1_STICKERS.find((asset) => asset.id === sticker) : sticker
  if (!item) throw new Error('阿狐表情不存在')
  return `${import.meta.env.BASE_URL}brand/ohu-v1/stickers/${item.file}`
}

/** Use the original transparent PNG with the existing avatar/chat upload rules. */
export async function foxV1StickerFile(id: FoxV1StickerId): Promise<File> {
  const item = FOX_V1_STICKERS.find((asset) => asset.id === id)
  if (!item) throw new Error('阿狐表情不存在')
  const response = await fetch(foxV1StickerUrl(item))
  if (!response.ok) throw new Error('阿狐图片暂时无法读取')
  const blob = await response.blob()
  if (!blob.size) throw new Error('阿狐图片暂时无法读取')
  return new File([blob], item.file, { type: 'image/png' })
}
