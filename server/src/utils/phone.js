// 手机号规范化：国内统一为 +86 开头的 E.164 格式。
// 格式变体不能变成两个账号。

export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  // 国内 11 位手机号
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+86' + digits;
  }
  // 已带 +86
  if (digits.length === 13 && digits.startsWith('861')) {
    return '+' + digits;
  }
  return null;
}

export function maskPhone(phone) {
  const p = phone || '';
  if (p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}
