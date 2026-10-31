/**
 * AI 出题（1.2.34 · OP-C 一期）
 * 复用 askSunshine()，不新增后端。Prompt 强制只输出 JSON。
 */
import { askSunshine, type ChatMsg } from '../../lib/ai-chat'
import { QBANK_ERRORS } from './errors'
import { parseAIQuestionsJson, type ParsedQuestion } from './parse'

export type GenType = 'single' | 'judge' | 'mix' | 'trans'
export type TransDir = 'both' | 'zh2en' | 'en2zh'
export type Difficulty = 1 | 2 | 3 | 4 | 5

export interface GenerateConfig {
  count?: number
  type?: GenType
  dir?: TransDir
  difficulty?: Difficulty
  tags?: string[]
}

export interface GenerateResult {
  ok: boolean
  questions: ParsedQuestion[]
  error?: string
}

const TYPE_LABEL: Record<GenType, string> = {
  single: '单项选择题（四个选项，一个正确答案）',
  judge: '判断题（对 / 错）',
  mix: '选择题和判断题各占一半左右',
  trans: '中英互译题（中文译英文 / 英文译中文）。stem 给原句并用【中译英】或【英译中】标注方向，options 给四句译文，其中一句正确，其余是时态/搭配/漏译上有毛病的错译',
}

const DIR_LABEL: Record<TransDir, string> = {
  both: '中译英、英译中两个方向都要出',
  zh2en: '全部中文译英文（stem 中文，options 英文译文）',
  en2zh: '全部英文译中文（stem 英文，options 中文译文）',
}

function buildPrompt(text: string, cfg: Required<Pick<GenerateConfig, 'count' | 'type' | 'dir' | 'difficulty'>> & { tags: string[] }) {
  const lines = [`你是大学出题老师。根据下面的资料出 ${cfg.count} 道${TYPE_LABEL[cfg.type]}，供学生自测。`]
  if (cfg.type === 'trans') lines.push(`互译方向：${DIR_LABEL[cfg.dir]}。`)
  lines.push(
    `难度 ${cfg.difficulty}/5${cfg.tags.length ? `，标签 ${cfg.tags.join('、')}` : ''}。`,
    '硬性要求：',
    '1. 只输出一个 JSON 数组，不要 Markdown 代码块围栏，不要任何解释或前后缀。',
    '2. 数组元素字段：{"question_type":"single_choice","stem":"题干","options":[{"key":"A","text":"选项"}],"answer":"A","explanation":"解析","difficulty":3,"tags":["标签"]}；判断题用 question_type "judge"、answer 用 "true"/"false"、options 空数组。',
    '3. 单选 answer 必须落在 options 的 key 集合内（A/B/C/D）。',
    '4. explanation ≤ 80 字。',
    '5. 题目必须基于资料原文，不编造资料外信息。',
    '资料：',
    text.slice(0, 6000),
  )
  return lines.join('\n')
}

export async function generateQuestionsFromText(text: string, cfg: GenerateConfig = {}): Promise<GenerateResult> {
  const count = Math.min(Math.max(cfg.count ?? 5, 3), 10)
  const type = cfg.type ?? 'mix'
  const dir = cfg.dir ?? 'both'
  const difficulty = Math.min(5, Math.max(1, cfg.difficulty ?? 3)) as Difficulty
  const tags = (cfg.tags || []).slice(0, 4)

  if (text.trim().length < 40) {
    return { ok: false, questions: [], error: QBANK_ERRORS.tooShort }
  }

  const messages: ChatMsg[] = [{ role: 'user', content: buildPrompt(text, { count, type, dir, difficulty, tags }) }]
  const res = await askSunshine(messages)
  if (!res.ok) {
    const err = res.error || ''
    return { ok: false, questions: [], error: err === 'network' ? QBANK_ERRORS.netFail : QBANK_ERRORS.modelFail }
  }
  if (!res.reply) return { ok: false, questions: [], error: QBANK_ERRORS.jsonFail }

  const parsed = parseAIQuestionsJson(res.reply)
  if (!parsed.ok || parsed.questions.length === 0) {
    return { ok: false, questions: [], error: QBANK_ERRORS.noQuestions }
  }
  return { ok: true, questions: parsed.questions }
}
