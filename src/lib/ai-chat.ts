/* 阳光聊天请求：只封装现有 /api/chat，不改后端契约 */
import { API_BASE } from './gateway'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface AskResult {
  ok: boolean
  reply?: string
  error?: string
  detail?: string
}

/**
 * 净化模型输出里的 emoji —— 手机端会渲染成空框（豆腐块）。
 *
 * 线上实测（jou 环境 /api/chat）：模型几乎每次回答都会带 1 个
 * 「符号 + VS16」组合，例如 ♻️ = U+267B + U+FE0F、⚠️ = U+26A0 + U+FE0F。
 * 这两类字符在 Android WebView 的系统 emoji 字体里没有对应字形，
 * 会渲染成「☐」。此外 📋 / 🎯 / 🤔 等页内 emoji 也有缺字风险。
 *
 * 处理策略：把「emoji + 其修饰符 + 紧随其后的空格」整体删掉，
 * 而不是替换成字符 —— 避免留下孤立空格或双空格。
 * 保留中文标点、全角符号、箭头（→）等正常可渲染字符。
 */
const EMOJI_RE = new RegExp(
  '[' +
    '\\u{1F000}-\\u{1FAFF}' + // 各类 emoji（含 📋 🎯 🙋 👋 📍 🔒 等）
    '\\u{2600}-\\u{27BF}' + // 杂项符号与装饰符（♻ ⚠ ✅ ❌ ✨ 等）
    '\\u{2B00}-\\u{2BFF}' + // 杂项符号与箭头
    '\\u{FE0F}\\u{FE0E}' + // 变体选择符 VS16 / VS15（豆腐块直接元凶）
    '\\u{20E3}' + // 键帽组合符
    '\\u{200D}' + // 零宽连接符 ZWJ
    '\\u{1F3FB}-\\u{1F3FF}' + // 肤色修饰符
    ']',
  'gu',
)

export function stripEmoji(text: string): string {
  if (!text) return text
  return text
    .replace(EMOJI_RE, '')
    .replace(/[ \t]+(?=\n)/g, '') // 行尾空格
    .replace(/[ \t]{2,}/g, ' ') // emoji 被摘掉后残留的双空格
    .replace(/\n{3,}/g, '\n\n') // 连续空行压成一行
    .trim()
}

/**
 * 对话展示用的兜底整形（不影响出题场景的 JSON）。
 * 模型不一定 100% 遵守格式约定，这里把最容易露馅的几类再压一遍：
 *   - ``` 代码围栏   - # 标题   - ** 加粗   - "- " 列表   - /xxx 内部路由
 * 斜杠规则刻意保守：要求斜杠后紧跟小写英文且长度 ≥3，避免误伤「2026/09/29」「和/或」。
 */
export function tidyReplyText(text: string): string {
  if (!text) return text
  return text
    .replace(/^\s*```[a-zA-Z]*\s*$/gm, '') // 代码围栏行
    .replace(/^\s*#{1,6}\s+/gm, '') // 标题井号
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **加粗**
    .replace(/^\s*[-*]\s+/gm, '· ') // 列表符号
    .replace(/(^|[\s(（])\/[a-z][a-z0-9_-]{2,}(?![a-zA-Z])/g, '$1') // 内部路由
    .replace(/[ \t]{2,}/g, ' ') // 摘掉路径/markdown 后残留的双空格
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function askSunshine(messages: ChatMsg[], signal?: AbortSignal): Promise<AskResult> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    })
  } catch (e) {
    return { ok: false, error: 'network', detail: (e as Error).message || '网络请求失败' }
  }
  let data: unknown
  try {
    data = await resp.json()
  } catch {
    return { ok: false, error: 'bad-response', detail: '服务返回异常，请稍后重试' }
  }
  const d = data as { ok?: boolean; reply?: string; error?: string; detail?: string }
  return {
    ok: !!d.ok,
    reply: typeof d.reply === 'string' ? stripEmoji(d.reply) : undefined,
    error: d.error || '',
    detail: d.detail || '',
  }
}

export const CAMPUS_PROMPTS = [
  '驾校怎么报名？',
  '宿舍日用品怎么买？',
  '附近有什么服务？',
  '有什么校园任务？',
]
