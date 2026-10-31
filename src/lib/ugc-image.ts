/**
 * UGC 图片上传（任务 / 帖子等通用场景）
 *
 * 校验规则、错误文案与聊天图片完全一致（同一套白名单、2MB 上限），
 * 只是按调用方给的目录归档，避免所有用户内容都堆在一个前缀下。
 * 复用 chat-image.ts 的底座，不另写一份，免得两边规则漂移。
 */
import { uploadToBucket, type ChatImageRes } from './chat-image'

/** @param dir 桶内的一级目录，如 'tasks'；实际路径为 {dir}/{uid}/ */
export function uploadUgcImage(file: File, uid: string, dir = 'ugc'): Promise<ChatImageRes> {
  return uploadToBucket(file, `${dir}/${uid || 'guest'}/`)
}
