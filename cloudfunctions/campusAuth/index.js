/**
 * 安全停用旧未验证学号建档接口。
 * 已有账号由客户端直接走 CloudBase signInWithPassword，正确密码登录不受影响。
 * 不依据调用方传入的学号/密码创建账户、重置密码或返回用户 UID。
 * 恢复首次建档前，必须实现并核验服务端教务身份验证，不能相信客户端门禁结果。
 */
function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 跨域头由 CloudBase 网关按「安全域名」白名单注入（已覆盖套壳 https://localhost 与托管域）；
      // 这里不放 '*'：网关只在 origin 未命中白名单时透传函数头，放了等于给陌生站点开门。
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}

exports.main = async (event = {}) => {
  const method = event.httpMethod || event.requestContext?.http?.method || ''
  if (method === 'OPTIONS') return httpResponse(204, {})
  const body = {
    ok: false,
    code: 'VERIFIED_REGISTRATION_REQUIRED',
    message: '学号建档需完成服务端身份验证，当前请联系管理员开通 App 账号，或使用手机验证码注册。',
  }
  return method ? httpResponse(403, body) : body
}
