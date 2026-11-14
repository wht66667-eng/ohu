/**
 * 账单 CSV 导入纯函数回归（M2.5·B1）：编码探测、双表头解析、清洗、去重键与疑似同一笔。
 * 被测模块零运行时 import，Node 24 按类型擦除加载。
 * 运行：`node --test tools/bill-import.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decodeBillText,
  merchantKey,
  minuteBucket,
  billDedupeKey,
  sniffBillChannel,
  parseWechatBill,
  parseAlipayBill,
  parseBillCsv,
  flagSuspectedDuplicates,
} from '../src/lib/bill-csv.ts'
import { tornPolygonPoints } from '../src/lib/torn-shape.ts'
import { extractBillFromText } from '../src/lib/bill-ocr.ts'

function bytes(...parts) {
  return new Uint8Array(parts.flat()).buffer
}
const utf8 = text => new TextEncoder().encode(text).buffer

const WECHAT_CSV = [
  '微信支付账单明细,,,,,,,,,,',
  '----------------------微信支付账单明细--------------------,,,,,,,',
  '账单用途：个人对账,,,,,,,,,,,',
  ',,,,,,,,,,',
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '"2026-11-08 12:30:11","商户消费","食堂超市","午餐","支出","¥12.50","零钱","支付成功","4200000123","M123",""',
  '"2026-11-08 12:30:40","微信红包","李雷","现金红包","收入","¥8.88","零钱","已存入零钱","4200000456","",""',
  '"2026-11-08 13:00:00","商户消费","书咖","拿铁","支出","¥18.00","零钱","已退款","4200000789","",""',
  '"2026-11-09 09:00:00","转账-退款","王芳","退还借款","/","¥50.00","零钱","退款","4200000999","",""',
  ',,,,,,,,,,',
  '共计20笔,,,,,,,',
].join('\n')

const ALIPAY_CSV = [
  '支付宝（中国）网络技术有限公司  交易流水明细',
  '账号:ohu@example.com',
  '起止日期:[2026-11-01 - 2026-11-10]',
  '----------------------------------------',
  '交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态',
  '2026110820004001,PO1,2026-11-08 12:30:30,2026-11-08 12:30:31,2026-11-08 12:30:31,中国,即时到账交易,"食堂超市",午餐,12.50,支出,交易成功,0.00,0.00,,已支出',
  '2026110820004002,PO2,2026-11-08 18:02:00,2026-11-08 18:02:01,2026-11-08 18:02:01,中国,即时到账交易,"奶茶店",珍珠奶茶,9.90,支出,退款成功,0.00,9.90,,退款',
  '2026110920004003,PO3,2026-11-09 21:10:05,2026-11-09 21:10:06,2026-11-09 21:10:06,中国,转账,"韩梅梅",生活费,500.00,收入,交易成功,0.00,0.00,,已收入',
  '2026110920004004,PO4,2026-11-09 22:00:00,,2026-11-09 22:00:00,中国,理财,"余额宝-转出","转出到银行卡",1000.00,不计收支,交易成功,0.00,0.00,,其他',
  '----------------------------------------',
  '统计：4笔',
].join('\n')

test('decodeBillText 识别 UTF-8 BOM 并剥除', () => {
  const buffer = bytes([0xef, 0xbb, 0xbf], [...new TextEncoder().encode('交易时间,收/支')])
  assert.equal(decodeBillText(buffer), '交易时间,收/支')
})

test('decodeBillText 无 BOM 严格 UTF-8 失败时回落 GBK', () => {
  // 「性」的 GBK 编码 0xD0 0xD4 不是合法 UTF-8 序列，必须走 GBK 回落。
  assert.equal(decodeBillText(new Uint8Array([0xd0, 0xd4]).buffer), '性')
  // 纯 ASCII 在严格 UTF-8 下已可解，不应误入 GBK 分支。
  assert.equal(decodeBillText(new TextEncoder().encode('2026-11-08,12.50,out').buffer), '2026-11-08,12.50,out')
})

test('decodeBillText 严格 UTF-8 可解时按 UTF-8（不误判 GBK）', () => {
  const text = '交易时间,交易对方,金额(元)'
  assert.equal(decodeBillText(utf8(text)), text)
})

test('merchantKey 去空格与连字符并截断到 8 字', () => {
  assert.equal(merchantKey(' 食堂 - 超市 '), '食堂超市')
  assert.equal(merchantKey('海底捞火锅外卖全国连锁'), '海底捞火锅外卖全')
  assert.equal(merchantKey(''), '')
})

test('minuteBucket 按分钟取整', () => {
  const base = Date.UTC(2026, 10, 8, 4, 30, 0)
  assert.equal(minuteBucket(base + 59_999), minuteBucket(base))
  assert.notEqual(minuteBucket(base + 60_000), minuteBucket(base))
})

test('billDedupeKey 同笔稳定、跨分钟/跨金额/跨渠道不同', async () => {
  const at = Date.UTC(2026, 10, 8, 4, 30, 11)
  const key = await billDedupeKey('wechat', 1250, '食堂超市', at)
  assert.equal(key.length, 64)
  assert.equal(key, await billDedupeKey('wechat', 1250, ' 食堂-超市 ', at + 30_000))
  assert.notEqual(key, await billDedupeKey('wechat', 1250, '食堂超市', at + 61_000))
  assert.notEqual(key, await billDedupeKey('wechat', 1260, '食堂超市', at))
  assert.notEqual(key, await billDedupeKey('alipay', 1250, '食堂超市', at))
})

test('sniffBillChannel 识别微信/支付宝/未知', () => {
  assert.equal(sniffBillChannel(WECHAT_CSV), 'wechat')
  assert.equal(sniffBillChannel(ALIPAY_CSV), 'alipay')
  assert.equal(sniffBillCsvUnknown(), null)
  function sniffBillCsvUnknown() { return sniffBillChannel('序号,名称,金额\n1,杂项,1.00') }
})

test('parseWechatBill 提取数据行、跳过退款与汇总', () => {
  const bill = parseWechatBill(WECHAT_CSV)
  assert.equal(bill.channel, 'wechat')
  assert.equal(bill.rows.length, 2)
  assert.equal(bill.skipped, 4)
  const [first] = bill.rows
  assert.equal(first.amountCents, 1250)
  assert.equal(first.direction, 'out')
  assert.equal(first.merchant, '食堂超市')
  assert.equal(first.note, '午餐')
  assert.equal(first.rawId, '4200000123')
  const at = first.occurredAt
  const date = new Date(at)
  assert.equal(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`, '2026-11-8 12:30')
})

test('parseAlipayBill 提取数据行、跳过退款与不计收支', () => {
  const bill = parseAlipayBill(ALIPAY_CSV)
  assert.equal(bill.rows.length, 2)
  assert.equal(bill.skipped, 4)
  const [, income] = bill.rows
  assert.equal(income.direction, 'in')
  assert.equal(income.amountCents, 50_000)
  assert.equal(income.merchant, '韩梅梅')
  assert.equal(income.rawId, '2026110920004003')
})

test('parseBillCsv 自动嗅探并解析', () => {
  assert.equal(parseBillCsv(WECHAT_CSV).rows.length, 2)
  assert.equal(parseBillCsv(ALIPAY_CSV).rows.length, 2)
  assert.equal(parseBillCsv('a,b,c'), null)
})

test('flagSuspectedDuplicates 跨渠道同金额同商户 120 秒内互相标记', () => {
  const at = Date.UTC(2026, 10, 8, 4, 30, 0)
  const rows = [
    { channel: 'wechat', direction: 'out', amountCents: 1250, merchant: '食堂超市', occurredAt: at },
    { channel: 'alipay', direction: 'out', amountCents: 1250, merchant: '食堂-超市', occurredAt: at + 60_000 },
    { channel: 'alipay', direction: 'out', amountCents: 1250, merchant: '食堂超市', occurredAt: at + 300_000 },
    { channel: 'alipay', direction: 'in', amountCents: 1250, merchant: '食堂超市', occurredAt: at + 10_000 },
    { channel: 'alipay', direction: 'out', amountCents: 990, merchant: '食堂超市', occurredAt: at + 10_000 },
  ]
  const flagged = flagSuspectedDuplicates(rows)
  assert.equal(flagged[0].suspect, true)
  assert.equal(flagged[1].suspect, true)
  assert.equal(flagged[2].suspect, undefined, '超过 120 秒不标')
  assert.equal(flagged[3].suspect, undefined, '方向不同不标')
  assert.equal(flagged[4].suspect, undefined, '金额不同不标')
  assert.equal(rows[0].suspect, undefined, '不改动输入行')
})

test('tornPolygonPoints 同种子形状一致、跨种子不同', () => {
  const a = tornPolygonPoints('photo-id-1')
  const b = tornPolygonPoints('photo-id-1')
  const c = tornPolygonPoints('photo-id-2')
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.equal(a.length, 26)
})

test('tornPolygonPoints 点位围绕中心、半径在撕边抖动带内', () => {
  for (const point of tornPolygonPoints('seed-x')) {
    const radius = Math.hypot(point.x - 0.5, point.y - 0.5)
    assert.ok(radius <= 0.5001, `超出画布 ${radius}`)
    assert.ok(radius >= 0.36, `过度内缩 ${radius}`)
  }
})

test('extractBillFromText 微信支付截图文本抽金额与商户', () => {
  const text = ['微信支付', '当前状态 支付成功', '付款方 食堂超市', '金额 ¥12.50', '支付时间 2026-11-13 12:30'].join('\n')
  const row = extractBillFromText(text)
  assert.ok(row)
  assert.equal(row.amountCents, 1250)
  assert.equal(row.direction, 'out')
  assert.equal(row.merchant, '食堂超市')
  assert.equal(row.channel, 'wechat')
})

test('extractBillFromText 支付宝收入与退款方向', () => {
  const income = extractBillFromText(['支付宝交易', '收款方 韩梅梅', '金额 500.00 元', '收款'].join('\n'))
  assert.ok(income)
  assert.equal(income.direction, 'in')
  assert.equal(income.amountCents, 50000)
  assert.equal(extractBillFromText('已退款 ¥18.00'), null, '退款不入草稿')
})
