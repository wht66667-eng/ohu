/**
 * 出题/入库错误短句（1.2.34 · 去 AI 化）
 * 五类错误统一在此定义，页面只取文案，不写长解释。
 */
export const QBANK_ERRORS = {
  modelFail: '出题失败，稍后重试',
  jsonFail: '模型返回格式异常，换段资料重试',
  noQuestions: '模型没返回有效题目，换段资料重试',
  allDuplicate: '这些题都已在题库里',
  permission: '没有权限',
  netFail: '网络异常，稍后重试',
  tooShort: '资料太短，至少 40 字',
  emptyTitle: '请填卷名',
} as const

export type QbankErrorKey = keyof typeof QBANK_ERRORS
