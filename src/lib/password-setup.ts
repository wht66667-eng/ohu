export type PasswordSetupInput = { password: string; code: string }

export function passwordSetupError(input: PasswordSetupInput): string | null {
  if (input.password.length < 6) return '密码至少 6 位'
  if (input.password.length > 128) return '密码过长，请控制在 128 位以内'
  if (!/^\d{6}$/.test(input.code.trim())) return '请输入 6 位短信验证码'
  return null
}

/** Nicknames and academic details are deliberately absent from the credential API. */
export async function applyPasswordSetup(input: PasswordSetupInput, verify: (args: { nonce: string; password: string }) => Promise<unknown>): Promise<unknown> {
  const error = passwordSetupError(input)
  if (error) throw new Error(error)
  return verify({ nonce: input.code.trim(), password: input.password })
}

export function passwordSetupMessage(message: string): string {
  if (/password.*(?:pattern|invalid|format)|密码.*(?:格式|规则)/i.test(message)) return '密码格式未通过验证，请换用字母与数字组合后重试。'
  if (/username|EditUserBasicInfoRequest|regex|regexp/i.test(message)) return '密码设置未完成，请重新获取验证码后重试；昵称无需修改。'
  if (/nonce|verification.*(?:invalid|expired)|验证码.*(?:过期|错误)/i.test(message)) return '验证码不正确或已过期，请重新获取。'
  return /[\u4e00-\u9fff]/u.test(message) && !/[{}]|Request\./.test(message) ? message : '密码设置未完成，请检查验证码后重试。'
}
