import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTiceDetailText } from '../src/lib/tice-parse.ts'

const text = `学生历年体质测试成绩
序号\t项目名称\t测试成绩\t分数\t结论
1\t身高(cm)\t182.0\t---\t---
2\t体重(kg)\t66.2\t0\t
3\t肺活量\t4592\t12\t良好
4\t50米跑(秒)\t6.3\t20\t优秀
5\t立定跳远(cm)\t210.0\t6\t及格
6\t千米跑(分)\t3.46\t15\t及格
7\t坐体前屈(cm)\t0.0\t1\t不及格
8\t引体向上/仰卧起坐\t6\t1\t不及格
总计\t\t\t70\t及格`

test('体测历年具体信息：逐项解析并取总分', () => {
  const year = parseTiceDetailText(text, '2025-2026')
  assert.ok(year)
  assert.equal(year.total, 70)
  assert.equal(year.grade, '及格')
  assert.equal(year.items.length, 8)
  assert.equal(year.items[2].name, '肺活量')
  assert.equal(year.items[2].raw, '4592')
  assert.equal(year.items[2].score, 12)
  assert.equal(year.items[1].name, '体重(kg)')
})
