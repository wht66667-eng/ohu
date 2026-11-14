/**
 * 截图 OCR → 账单草稿（M2.5·B2）。
 *
 * 引擎：tesseract.js（中文模型 chi_sim）——worker/wasm/训练数据全部自托管在
 * `public/ocr/`，不引 CDN、不上传图片，全程本机识别。
 * 抽取：`extractBillFromText` 是纯函数（Node 可测），把识别文本里的金额／收支／
 * 商户整理成 ParsedBillRow，喂给与 CSV 相同的草稿箱链路（去重、疑似同一笔、确认入账）。
 * 识别文本质量有限：抽取结果永远经草稿箱由用户确认，不静默入账（方案 §5）。
 */
import type { ParsedBillRow } from './bill-csv'

/** Vite 注入 BASE_URL；Node 测试环境无该字段时回落 '/'。 */
function ocrAssetDir(): string {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } }
  return `${meta.env?.BASE_URL ?? '/'}ocr/`
}
const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function isOcrSupported(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && SUPPORTED_TYPES.length > 0
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>
let enginePromise: Promise<OcrWorker> | null = null

async function getOcrWorker(): Promise<OcrWorker> {
  const { createWorker } = await import('tesseract.js')
  if (!enginePromise) {
    enginePromise = createWorker('chi_sim', 1, {
      workerPath: `${ocrAssetDir()}worker.min.js`,
      corePath: ocrAssetDir(),
      langPath: ocrAssetDir(),
      logger: () => { /* 进度不落库不打日志，避免泄露截图内容。 */ },
    }).catch(error => { enginePromise = null; throw error })
  }
  return enginePromise
}

/** 识别一张账单截图，返回全文文本（调用方负责抽取与丢弃，原文不落库）。 */
export async function recognizeBillImage(file: File): Promise<string> {
  if (!SUPPORTED_TYPES.includes(file.type)) throw new Error('仅支持 PNG／JPG／WebP 截图。')
  if (file.size > 8 * 1024 * 1024) throw new Error('截图过大，请裁剪后重试（8MB 内）。')
  const worker = await getOcrWorker()
  const result = await worker.recognize(file)
  const text = result?.data?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('没有识别出文字，请换一张更清晰的截图。')
  return text
}

/** 从识别文本抽取一笔账单；抽不到金额或方向时返回 null（引导手动记一笔）。 */
export function extractBillFromText(text: string, now = Date.now()): ParsedBillRow | null {
  const clean = (text || '').replace(/\s+/g, ' ')
  // OCR 常在汉字/符号间插入空格、丢掉 ¥ 符号：紧凑文本用于金额与商户定位。
  const compact = (text || '').replace(/\s+/g, '')
  const direction = /退款|退回/.test(clean) ? null : /收款|收入|到账|转入/.test(clean) ? 'in' : /支出|付款|支付|消费/.test(clean) ? 'out' : null
  if (!direction) return null
  const amounts: number[] = []
  const amountPattern = /[¥￥](\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|金额[：:]?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*元/g
  for (const match of compact.matchAll(amountPattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').replace(/,/g, '')
    const cents = Math.round(Number(value) * 100)
    if (Number.isSafeInteger(cents) && cents > 0) amounts.push(cents)
  }
  if (!amounts.length) return null
  // 截图里可能出现找零/优惠：取金额集合中的最大值作为交易额（收/支文案已先行过滤）。
  const amountCents = Math.max(...amounts)
  const channel = /支付宝|alipay/i.test(compact) ? 'alipay' : /微信|weixin|wechat/i.test(compact) ? 'wechat' : 'other'
  // 商户：优先「付款方/收款方/商户」标签后的字段（紧凑文本 + 关键词截断），兜底最长纯中文行。
  let merchant = ''
  const labeled = compact.match(/(?:付款方|商户|收款方|对方)[：:]?(.{2,30}?)(?=金额|当前状态|支付|交易|收款时间|付款时间|$)/)
  if (labeled) merchant = labeled[1].replace(/[：:]/g, '')
  if (!merchant) {
    const lines = text.split(/\n+/).map(line => line.replace(/\s+/g, '').trim()).filter(Boolean)
    merchant = lines.filter(line => /^[\u4e00-\u9fa5A-Za-z0-9·（）()\-—_]{2,24}$/.test(line) && !/[¥￥]|\d{2,}/.test(line) && !/状态|成功|时间|金额|账单|支付|收款|付款/.test(line))
      .sort((a, b) => b.length - a.length)[0] ?? ''
  }
  merchant = merchant.slice(0, 30) || '截图识别'
  return { channel, direction, amountCents, merchant, note: '截图识别（请核对）', occurredAt: now }
}
