import test from 'node:test'
import assert from 'node:assert/strict'
import { formatListingPrice } from '../src/lib/listing-price.ts'

test('listing prices preserve negotiation and avoid duplicate currency', () => {
  for (const [value, expected] of [[3, '¥3'], [0, '¥0'], ['3元', '¥3'], ['￥ 3.50', '¥3.50'], ['¥8', '¥8'], ['面议', '面议'], ['免费', '免费'], ['3元起', '3元起'], ['', '价格待补充'], [null, '价格待补充'], [NaN, '价格待补充'], [-1, '价格待补充']]) {
    assert.equal(formatListingPrice(value), expected)
  }
})
