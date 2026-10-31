/** Preserve negotiated prices and normalize only complete currency amounts. */
export function formatListingPrice(value: string | number | null | undefined): string {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? `¥${value}` : '价格待补充'
  const text = (value || '').trim()
  if (!text) return '价格待补充'
  const amount = text.match(/^(?:[¥￥]\s*)?(\d+(?:\.\d+)?)\s*(?:元)?$/)
  return amount ? `¥${amount[1]}` : text
}
