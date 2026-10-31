/**
 * 背单词计划：系统默认 + 学生自定义（本地）。
 */
import type { WordBankId } from '../../data/words/banks'
import { WORD_BANK_META } from '../../data/words/banks'
import { readWordStudy, updateWordStudy } from './study-storage'

export interface StudyPlan {
  id: string
  name: string
  /** 覆盖的词库 */
  bankIds: WordBankId[]
  /** 每日目标题量 */
  dailyGoal: number
  system?: boolean
  createdAt: number
}

export const SYSTEM_PLANS: StudyPlan[] = [
  {
    id: 'sys-cet4',
    name: '四级稳步',
    bankIds: ['cet4'],
    dailyGoal: 15,
    system: true,
    createdAt: 0,
  },
  {
    id: 'sys-cet6',
    name: '六级冲刺',
    bankIds: ['cet6'],
    dailyGoal: 12,
    system: true,
    createdAt: 0,
  },
  {
    id: 'sys-kaoyan',
    name: '考研核心',
    bankIds: ['kaoyan'],
    dailyGoal: 20,
    system: true,
    createdAt: 0,
  },
  {
    id: 'sys-ielts',
    name: '雅思常用',
    bankIds: ['ielts'],
    dailyGoal: 15,
    system: true,
    createdAt: 0,
  },
  {
    id: 'sys-mix',
    name: '四六级混合',
    bankIds: ['cet4', 'cet6'],
    dailyGoal: 18,
    system: true,
    createdAt: 0,
  },
]

export function listPlans(): StudyPlan[] {
  return [...SYSTEM_PLANS, ...readWordStudy().plans]
}

export function getActivePlanId(): string {
  return readWordStudy().activePlan || 'sys-cet4'
}

export function setActivePlanId(id: string) {
  if (!listPlans().some((plan) => plan.id === id)) return
  updateWordStudy((bundle) => { bundle.activePlan = id })
}

export function getActivePlan(): StudyPlan {
  const id = getActivePlanId()
  return listPlans().find((p) => p.id === id) || SYSTEM_PLANS[0]
}

export function createPlan(input: {
  name: string
  bankIds: WordBankId[]
  dailyGoal: number
}): StudyPlan {
  const plan: StudyPlan = {
    id: `custom-${Date.now().toString(36)}`,
    name: (input.name || '我的计划').trim().slice(0, 24) || '我的计划',
    bankIds: input.bankIds.length ? input.bankIds : ['cet4'],
    dailyGoal: Math.min(50, Math.max(5, input.dailyGoal || 15)),
    system: false,
    createdAt: Date.now(),
  }
  updateWordStudy((bundle) => {
    bundle.plans = [plan, ...bundle.plans.filter((item) => item.id !== plan.id)]
    bundle.activePlan = plan.id
  })
  return plan
}

export function deletePlan(id: string) {
  if (id.startsWith('sys-')) return
  updateWordStudy((bundle) => {
    bundle.plans = bundle.plans.filter((plan) => plan.id !== id)
    if (bundle.activePlan === id) bundle.activePlan = 'sys-cet4'
  })
}

export function planLabel(p: StudyPlan): string {
  const banks = p.bankIds.map((b) => WORD_BANK_META[b]?.name || b).join('+')
  return `${p.name} · ${banks} · 日${p.dailyGoal}词`
}
