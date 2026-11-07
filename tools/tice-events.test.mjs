import test from 'node:test'
import assert from 'node:assert/strict'
import { ticeEventViews } from '../src/lib/tice-parse.ts'

test('体测：BMI、肺活量、50m、1000m/800m、坐位体前屈、引体向上都展示', () => {
  const items = [
    { name: '身高测量', raw: '170', score: null, note: '' },
    { name: '体重测量', raw: '60', score: null, note: '' },
    { name: '肺活量', raw: '4000', score: 80, note: '' },
    { name: '50米跑', raw: '7.2', score: 90, note: '' },
    { name: '立定跳远', raw: '2.3', score: 70, note: '' },
    { name: '坐体前屈', raw: '12.5', score: 75, note: '' },
    { name: '1000米跑', raw: '3.40', score: 60, note: '' },
    { name: '800米跑', raw: '3.50', score: 65, note: '' },
    { name: '引体向上', raw: '10', score: 80, note: '' },
  ]
  const views = ticeEventViews(items)
  assert.equal(views[0].name, 'BMI')
  assert.equal(views[0].raw, '20.8')
  assert.equal(views[0].weight, 15)
  const names = views.map((item) => item.name)
  for (const name of ['肺活量', '50米跑', '立定跳远', '坐位体前屈', '1000米跑', '800米跑', '引体向上']) {
    assert.ok(names.includes(name), name)
  }
  assert.equal(views.find((item) => item.name === '50米跑')?.weight, 20)
  assert.equal(views.find((item) => item.name === '1000米跑')?.weight, 20)
})
