/**
 * 功能开关（构建期注入）
 *
 * 用法：构建时带上环境变量才会生效，改完要**重新构建并发版**。
 *
 *   VITE_EMAIL_LOGIN=true npm run build:app     # 打开邮箱入口
 *   npm run build:app                            # 不带即关闭（默认）
 *
 * OTA 单发同理（base 必须是 ./）：
 *   VITE_EMAIL_LOGIN=true npx vite build --outDir dist-otaNNN --base ./ --emptyOutDir false
 *
 * 为什么邮箱登录默认关：
 *   1. 控制台「邮箱验证码」一旦开通就对所有人开放，邮箱注册成本极低（不需要实名手机号），
 *      容易被批量刷账号；
 *   2. 邮箱验证要走真实投递，垃圾箱 / 域名黑名单都会造成注册失败，客服压力大；
 *   3. 短信有 SmsDayLimit 兜底，邮箱没有对应配额保护。
 * 确认要开放时再打开本开关，出问题也能立刻关掉重新发版。
 */

/** 邮箱验证码登录 / 注册入口。默认关闭，手机号始终是主路径。 */
export const EMAIL_LOGIN = import.meta.env.VITE_EMAIL_LOGIN === 'true'

/** 账号框的占位文案：开关关着时不要误导用户去填邮箱 */
export const ACCOUNT_PLACEHOLDER = '学号'

/** 账号框上方的字段名 */
export const ACCOUNT_LABEL = EMAIL_LOGIN ? '账号（手机号 / 邮箱）' : '账号（手机号）'

/** 邮箱被输入但开关关着时的提示 */
export const EMAIL_DISABLED_HINT = '暂未开放邮箱登录，请先用手机号'

/** 账号格式不对时的提示 */
export const ACCOUNT_INVALID_HINT = EMAIL_LOGIN ? '请输入正确的手机号或邮箱' : '请输入正确的手机号'
