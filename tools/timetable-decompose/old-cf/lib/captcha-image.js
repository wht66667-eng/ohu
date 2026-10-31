'use strict'
/**
 * 【模块】验证码图片裁剪（纯字节处理，不联网）
 *
 * 来源：原 index.js 验证码一节的 cropCaptcha / captchaDataUrl（原第 1464-1491 行），代码逐行搬运。
 * 之所以从 captcha.js 里分出来：登录模块（login.tryZfnetCaptcha）也要裁剪验证码字节，
 * 若两者同处一个文件会形成 login ↔ captcha 的循环依赖。
 *
 * 依赖：无
 */

/**
 * 从验证码接口原始 body 中截出「首个完整图片流」。
 * 本校 CheckCode.aspx 有两处怪癖（已由实捕文件复现，勿删此逻辑）：
 *   ① 有效请求：JPEG 图片字节后紧跟整段登录页 HTML（服务端响应未清空。
 *      例：_cap_b.jpg 中 EOI 位于第 1719 字节，其后仍多 1086 字节 <!DOCTYPE html>…「欢迎使用正方教务管理系统」）；
 *   ② 失效/无会话请求：整包返回登录页 HTML，且 Content-Type 仍可能是 image/*（例：_cap_probe.jpg 以 \r\n<!DOCTYPE 开头）。
 * 因此一律先按真实图片头裁剪，再以裁剪结果是否仍为图片决定可用性，杜绝把 HTML 当验证码下发给前端。
 */
function cropCaptcha(buf) {
  if (!buf || buf.length < 4) return null
  let start = 0
  for (; start < buf.length - 1; start++) {
    const a = buf[start]
    const b = buf[start + 1]
    if ((a === 0xff && b === 0xd8) || (a === 0x89 && b === 0x50) || (a === 0x47 && b === 0x49)) break
  }
  if (start >= buf.length - 1) return null
  if (buf[start] === 0x47) return buf.subarray(start) // GIF：无内嵌 HTML 风险，原样收下
  if (buf[start] === 0x89) {
    // PNG：截到 IEND 块（含其后 4 字节 CRC）
    const end = buf.indexOf(Buffer.from('IEND', 'ascii'), start)
    return end > start ? buf.subarray(start, end + 8) : buf.subarray(start)
  }
  // JPEG：SOI(FFD8) → 首个 EOI(FFD9)；找不到 EOI 视为残帧丢弃
  for (let i = start + 1; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return buf.subarray(start, i + 2)
  }
  return null
}

/** 组装 data URL：mime 只取 image/* 且小写，规避偶发 `image/Jpeg` 前缀导致前端解析异常 */
function captchaDataUrl(ct, buf) {
  const raw = String(ct || '').split(';')[0].toLowerCase()
  const mime = /^image\/(jpeg|png|gif|webp)$/.test(raw) ? raw : buf[0] === 0x89 ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

module.exports = { cropCaptcha, captchaDataUrl }
