import { foxAssetUrl } from '../lib/fox-art'
import avatarStudent from '../assets/img/avatar-student.jpg'
import pBooks from '../assets/img/p-books.jpg'
import pEbike from '../assets/img/p-ebike.jpg'
import pBike from '../assets/img/p-bike.jpg'
import pLaptop from '../assets/img/p-laptop.jpg'
import pBag from '../assets/img/p-bag.jpg'
import pEarbuds from '../assets/img/p-earbuds.jpg'
import tParcel from '../assets/img/t-parcel.jpg'

export const avatar = {
  sun: '/brand/ohu-original/fox-avatar.webp',
  student: avatarStudent,
}

/** 未上传头像时，按 uid 确定性分配同一只像素狐狸的不同动作。 */
export const presetAvatars: string[] = [
  foxAssetUrl('avatar'),
  foxAssetUrl('welcome'),
  foxAssetUrl('reading'),
  foxAssetUrl('chat'),
  foxAssetUrl('cheer'),
  foxAssetUrl('shopping'),
  foxAssetUrl('parcel'),
  foxAssetUrl('search'),
  foxAssetUrl('food'),
  foxAssetUrl('guide'),
  foxAssetUrl('trophy'),
  foxAssetUrl('encourage'),
]

/**
 * 按字符串（uid / 昵称）确定性选一个预设头像。
 * 同一个用户保持同一个动作，刷新不变。
 */
export function pickPresetAvatar(seed: string): string {
  const s = String(seed || '').trim()
  if (!s) return presetAvatars[0]
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return presetAvatars[h % presetAvatars.length]
}

/**
 * 解析头像：保留用户上传的头像，否则按 uid 分配狐狸头像。
 */
export function resolveAvatar(uploaded: string | undefined | null, seed: string): string {
  if (uploaded) return uploaded
  return pickPresetAvatar(seed)
}

export const productImg = {
  book: pBooks,
  ebike: pEbike,
  bike: pBike,
  laptop: pLaptop,
  bag: pBag,
  earphone: pEarbuds,
} as const

/**
 * 列表缩略图。只保留**实际会传入的 kind**：
 * `ProductArt` 的调用点只有 `kind="box"`（信息站）与 `kind="goods"`（二手详情 / 集市），
 * 首页 `ListingPicture` 的 `listing.art` 也只有 'box' / 'goods' 两个取值。
 * 原先这里还挂着 tea / pen / badminton / printer / mountain / canteen / meal 等键，
 * 对应的是 1.2.98 就已下线的跑腿品类与食堂档口，连同 13 张 480² 的图一起删掉了。
 * `ProductArt` 是运行时 `kind in thumbImg` 判断，删键后未知 kind 走空占位块，不会报错。
 */
export const thumbImg = {
  box: tParcel,
  goods: pBag,
} as const

export type ThumbKey = keyof typeof thumbImg
