/**
 * 题目内容哈希（1.2.34）
 *
 * 任务书建议 md5，但浏览器 Web Crypto 不支持 MD5（仅 SHA-1/SHA-2）。
 * 这里用 FNV-1a 64-bit 同步哈希（纯前端无依赖、无需 async），输出 16 位 hex。
 * 用途仅是「本地预去重」；真正的强一致由 DB 唯一索引 uniq_questions_uid_hash 兜底。
 */
export function contentHash(stem: string, answer: string, qtype: string): string {
  const src = `${stem}|${answer}|${qtype}`
  let h1 = 0xcbf29ce484222325n
  let h2 = 0x84222325cbf29ce4n
  const FNV_PRIME = 0x100000001b3n
  for (let i = 0; i < src.length; i++) {
    const c = BigInt(src.charCodeAt(i))
    h1 = (h1 ^ c) * FNV_PRIME
    h2 = (h2 ^ c) * FNV_PRIME
    // 64-bit 截断（BigInt 会无限长）
    h1 &= 0xffffffffffffffffn
    h2 &= 0xffffffffffffffffn
  }
  const hex = (n: bigint) => n.toString(16).padStart(16, '0')
  return hex(h1) + hex(h2)
}
