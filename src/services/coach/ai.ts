/**
 * 教练草稿生成（M4）· 唯一 AI 出口走 agnes-ai 白名单 feature 'study-plan'。
 * 确定性规则优先：AI 仅产草稿文本，仍经 contract.ts 同一套解析与校验；失败映射到六类异常。
 * 预览不落库；确认写入是 M5 的事，本模块不触碰 todo / 手账 / IDB。
 */
import { AgnesAiError, requestAgnes } from '../../lib/agnes-ai.ts'
import {
  COACH_ERRORS,
  parseContractText,
  type CoachErrorKind,
  type CoachIssue,
  type TaskContract,
} from './contract.ts'

export type GenerateResult =
  | { ok: true; contract: TaskContract }
  | { ok: false; kind: CoachErrorKind; message: string; issues: CoachIssue[]; contract?: TaskContract }

function kindFromCode(code: string): CoachErrorKind {
  switch (code) {
    case 'AUTH_REQUIRED': return 'auth'
    case 'TIMEOUT': return 'timeout'
    case 'ABORTED': return 'timeout'
    case 'EMPTY_INPUT':
    case 'INPUT_TOO_LARGE':
    case 'INVALID_IMAGE': return 'schema'
    default: return 'network'
  }
}

/** 让模型只输出 TaskContract 1.1.0 JSON 的提示词（前端仍强制校验，脏数据不入库）。 */
export function buildCoachPrompt(goal: string, todayKey: string, horizonEnd: string): string {
  return [
    '你是学习教练。请只输出一个 JSON 对象，不要任何解释或 Markdown 围栏。',
    `契约 schema 固定为 "ohu.task-contract"，version 固定为 "1.1.0"。`,
    `horizon.start="${todayKey}"，horizon.end="${horizonEnd}"（YYYY-MM-DD）。`,
    'tasks 为数组，每项含 id(唯一字符串)、title、date(落在 horizon 内)、minutes(1-480 整数)、dependsOn(前置任务 id 数组，不可成环)、category、done(布尔)、note。',
    '请围绕下面的学习目标，排出可执行、依赖合理、单任务时长适中的计划：',
    goal.trim() || '本周课程复习与考试准备',
  ].join('\n')
}

export async function generateContract(goal: string, todayKey: string, horizonEnd: string, signal?: AbortSignal): Promise<GenerateResult> {
  try {
    const reply = await requestAgnes('study-plan', buildCoachPrompt(goal, todayKey, horizonEnd), signal, undefined, { includeLocalContext: false })
    const parsed = parseContractText(reply)
    if (parsed.ok) return { ok: true, contract: parsed.contract }
    if (parsed.kind === 'validation') return { ok: false, kind: 'validation', message: parsed.message, issues: parsed.issues, contract: parsed.contract }
    return { ok: false, kind: parsed.kind, message: parsed.message, issues: parsed.issues }
  } catch (error) {
    if (error instanceof AgnesAiError) {
      const kind = kindFromCode(error.code)
      return { ok: false, kind, message: error.message || COACH_ERRORS[kind].detail, issues: [{ code: error.code, message: error.message || COACH_ERRORS[kind].title }] }
    }
    return { ok: false, kind: 'network', message: COACH_ERRORS.network.detail, issues: [{ code: 'unknown', message: '生成失败，请重试' }] }
  }
}