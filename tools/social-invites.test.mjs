/**
 * 社工端邀请码与课表共享 · 纯函数回归（social-invites-helpers）。
 * 被测模块零运行时 import，Node 24 按类型擦除加载。
 * 运行：`node --test tools/social-invites.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  INVITE_ALPHABET,
  genInviteCode,
  normalizeInviteCodeInput,
  validateInviteCodeFormat,
  isCanonicalInviteCode,
  redeemResultText,
  shareFieldsFrom,
  shareFieldsText,
  shareFieldsEqual,
  inviteRowFromJson,
  inviteActive,
  inviteUsageText,
  isRpcMissingError,
  readableError,
  parseSharedSnapshot,
  courseRowTimeText,
  courseRowText,
  courseDayLabel,
  groupCoursesByDay,
  maskSocialUid,
  RELATION_OPTIONS,
  relationLabel,
  spaceFromJson,
  beijingDayNumber,
  companionDays,
  companionDayText,
  spaceDayText,
  normalizeRelationInput,
} from '../src/lib/social-invites-helpers.ts'

test('genInviteCode 产出 XXXX-XXXX 且不含易混淆字符', () => {
  const pattern = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
  const seen = new Set()
  for (let i = 0; i < 300; i += 1) {
    const code = genInviteCode()
    assert.match(code, pattern, `格式不合规: ${code}`)
    seen.add(code)
  }
  assert.ok(seen.size > 200, '300 次生成不应大量撞码')
})

test('genInviteCode 字符集与 SQL 迁移一致（31 个字符，无 I/O/0/1）', () => {
  assert.equal(INVITE_ALPHABET.length, 31)
  assert.equal(INVITE_ALPHABET.includes('I'), false)
  assert.equal(INVITE_ALPHABET.includes('O'), false)
  assert.equal(INVITE_ALPHABET.includes('0'), false)
  assert.equal(INVITE_ALPHABET.includes('1'), false)
})

test('genInviteCode 支持注入随机源（可复现）', () => {
  const bytes = new Uint8Array(8).fill(0)
  assert.equal(genInviteCode(() => bytes), 'AAAA-AAAA')
  const seq = new Uint8Array([0, 5, 10, 20, 30, 9, 17, 25])
  const code = genInviteCode(() => seq)
  assert.equal(code.slice(0, 1), 'A')
  assert.equal(code.length, 9)
})

test('normalizeInviteCodeInput 大小写/空格/连字符归一化', () => {
  assert.equal(normalizeInviteCodeInput('abcd-ef23'), 'ABCD-EF23')
  assert.equal(normalizeInviteCodeInput('abcdef23'), 'ABCD-EF23')
  assert.equal(normalizeInviteCodeInput(' ab12 cd34 '), 'AB12-CD34')
  assert.equal(normalizeInviteCodeInput('ABC'), '')
  assert.equal(normalizeInviteCodeInput('ABCDEFGH9'), '')
  assert.equal(normalizeInviteCodeInput(''), '')
  assert.equal(normalizeInviteCodeInput('abcd-ef2!'), '')
})

test('validateInviteCodeFormat 只看 8 位有效字符', () => {
  assert.equal(validateInviteCodeFormat('ABCD-EF23'), true)
  assert.equal(validateInviteCodeFormat('abcdef23'), true)
  assert.equal(validateInviteCodeFormat('ABCDEF2'), false)
  assert.equal(validateInviteCodeFormat('ABCD EF2!'), false)
  assert.equal(validateInviteCodeFormat(''), false)
})

test('isCanonicalInviteCode 只认生成侧的规范形态', () => {
  assert.equal(isCanonicalInviteCode('ABCD-EF23'), true)
  assert.equal(isCanonicalInviteCode('ABCDEFGH'), false)
  assert.equal(isCanonicalInviteCode('ABCD-EF2'), false)
  assert.equal(isCanonicalInviteCode('AB1D-EF23'), false)
})

test('redeemResultText 分档文案', () => {
  assert.equal(redeemResultText(true, null), '绑定成功，该邀请码可不限次使用')
  assert.equal(redeemResultText(true, 3), '绑定成功，该邀请码还可使用 3 次')
  assert.equal(redeemResultText(true, 1), '绑定成功，该邀请码还可使用 1 次')
  assert.equal(redeemResultText(true, 0), '绑定成功，该邀请码的使用名额已用完')
  assert.equal(redeemResultText(false, null), '绑定未成功，请核对邀请码后重试')
  assert.equal(redeemResultText(false, 0), '绑定未成功，请核对邀请码后重试')
})

test('shareFieldsFrom 缺省全开且只认布尔', () => {
  assert.deepEqual(shareFieldsFrom(null), { time: true, name: true, room: true })
  assert.deepEqual(shareFieldsFrom(undefined), { time: true, name: true, room: true })
  assert.deepEqual(shareFieldsFrom({}), { time: true, name: true, room: true })
  assert.deepEqual(shareFieldsFrom({ time: false }), { time: false, name: true, room: true })
  assert.deepEqual(shareFieldsFrom({ time: false, name: false, room: false }), { time: false, name: false, room: false })
  assert.deepEqual(shareFieldsFrom({ time: 'no', other: 1 }), { time: true, name: true, room: true })
})

test('shareFieldsText 三档文案与 shareFieldsEqual', () => {
  assert.equal(shareFieldsText({ time: true, name: true, room: true }), '上课时间 · 课程名 · 教室')
  assert.equal(shareFieldsText({ time: true, name: false, room: false }), '上课时间')
  assert.equal(shareFieldsText({ time: false, name: true, room: false }), '课程名')
  assert.equal(shareFieldsText({ time: false, name: false, room: true }), '教室')
  assert.equal(shareFieldsText({ time: false, name: false, room: false }), '不共享任何内容')
  assert.equal(shareFieldsEqual({ time: true, name: false, room: true }, { time: true, name: false, room: true }), true)
  assert.equal(shareFieldsEqual({ time: true, name: false, room: true }, { time: true, name: true, room: true }), false)
})

test('inviteRowFromJson 解析 status jsonb 行', () => {
  const row = inviteRowFromJson({
    code: 'ABCD-EF23',
    used_count: 1,
    max_uses: 1,
    expires_at: null,
    revoked: false,
    note: '给社工小王',
    created_at: '2026-11-13T00:00:00Z',
  })
  assert.ok(row)
  assert.equal(row.code, 'ABCD-EF23')
  assert.equal(row.usedCount, 1)
  assert.equal(row.maxUses, 1)
  assert.equal(inviteRowFromJson({ no_code: 1 }), null)
  assert.equal(inviteRowFromJson(null), null)
  assert.equal(inviteRowFromJson('x'), null)
})

test('inviteActive 与 inviteUsageText 四种状态', () => {
  const now = Date.now()
  const base = { code: 'ABCD-EF23', usedCount: 0, maxUses: 1, expiresAt: null, revoked: false, note: '', createdAt: '' }
  assert.equal(inviteActive({ ...base }), true)
  assert.equal(inviteUsageText({ ...base }), '已用 0/1 次')

  const usedUp = { ...base, usedCount: 1 }
  assert.equal(inviteActive(usedUp), false)
  assert.equal(inviteUsageText(usedUp), '已用尽')

  const expired = { ...base, expiresAt: new Date(now - 1000).toISOString() }
  assert.equal(inviteActive(expired), false)
  assert.equal(inviteUsageText(expired), '已过期')

  const revoked = { ...base, revoked: true }
  assert.equal(inviteActive(revoked), false)
  assert.equal(inviteUsageText(revoked), '已撤销')

  const unlimited = { ...base, maxUses: null }
  assert.equal(inviteActive(unlimited), true)
  assert.equal(inviteUsageText(unlimited), '已用 0 次 · 不限次数')
})

test('isRpcMissingError 识别 42883 / function not found', () => {
  assert.equal(isRpcMissingError({ code: '42883', message: 'function public.social_invite_status() does not exist' }), true)
  assert.equal(isRpcMissingError({ code: 'PGRST202' }), true)
  assert.equal(isRpcMissingError('function public.social_invite_status() does not exist'), true)
  assert.equal(isRpcMissingError({ message: 'Could not find the function social_invite_status' }), true)
  assert.equal(isRpcMissingError({ message: '权限不足' }), false)
  assert.equal(isRpcMissingError(null), false)
  assert.equal(isRpcMissingError(undefined), false)
  assert.equal(isRpcMissingError(''), false)
})

test('readableError 取 message/msg/字符串', () => {
  assert.equal(readableError(' boom '), 'boom')
  assert.equal(readableError({ message: '你已有一枚有效邀请码' }), '你已有一枚有效邀请码')
  assert.equal(readableError({ msg: '网络问题' }), '网络问题')
  assert.equal(readableError({}), '操作失败，请稍后重试')
  assert.equal(readableError(null, '兜底'), '兜底')
})

test('parseSharedSnapshot 兼容数组/rows 包裹/宽容字段并排序', () => {
  const rowA = { week: 3, day: 2, sections: [3, 4], name: '高等数学', room: 'A101', teacher: '张老师' }
  const rowB = { week: 3, day: 1, sections: [1], name: '大学英语', room: 'B202' }
  const arr = parseSharedSnapshot([rowA, rowB])
  assert.equal(arr.length, 2)
  assert.equal(arr[0].day, 1)
  assert.equal(arr[1].name, '高等数学')
  assert.deepEqual(arr[1].sections, [3, 4])

  const wrapped = parseSharedSnapshot({ rows: [rowB] })
  assert.equal(wrapped.length, 1)
  assert.equal(wrapped[0].name, '大学英语')

  assert.equal(parseSharedSnapshot(null).length, 0)
  assert.equal(parseSharedSnapshot('x').length, 0)
  assert.equal(parseSharedSnapshot([{ week: 0, day: 1, sections: [1], name: 'x' }]).length, 0)
  assert.equal(parseSharedSnapshot([{ week: 1, day: 9, sections: [1], name: 'x' }]).length, 0)
  assert.equal(parseSharedSnapshot([{ week: 1, day: 1, sections: [], name: 'x' }]).length, 0)
  assert.equal(parseSharedSnapshot([{ week: 1, day: 1, sections: [1], name: '' }]).length, 0)
})

test('courseRowTimeText/courseRowText 按三档开关渲染', () => {
  const row = { week: 3, day: 2, sections: [3, 4], name: '高等数学', room: 'A101', teacher: '' }
  assert.equal(courseRowTimeText(row), '周二 第 3-4 节')
  assert.equal(courseRowTimeText({ ...row, sections: [5] }), '周二 第 5 节')
  const all = { time: true, name: true, room: true }
  assert.equal(courseRowText(row, all), '周二 第 3-4 节 · 高等数学 · A101')
  assert.equal(courseRowText(row, { time: true, name: true, room: false }), '周二 第 3-4 节 · 高等数学')
  assert.equal(courseRowText(row, { time: false, name: true, room: true }), '高等数学 · A101')
  assert.equal(courseRowText(row, { time: false, name: false, room: true }), 'A101')
  assert.equal(courseRowText({ ...row, room: '' }, all), '周二 第 3-4 节 · 高等数学')
})

test('maskSocialUid 只展示前 6 后 4', () => {
  assert.equal(maskSocialUid('short'), 'short')
  assert.equal(maskSocialUid('stu_00112233445566778899aabbccdd'), 'stu_00…ccdd')
  assert.equal(maskSocialUid(''), '')
})

/* ===== TASK-A6 按天分组 ===== */

test('courseDayLabel 周一至周日与越界回退', () => {
  assert.equal(courseDayLabel(1), '周一')
  assert.equal(courseDayLabel(7), '周日')
  assert.equal(courseDayLabel(9), '周9')
  assert.equal(courseDayLabel(1.4), '周一')
})

test('groupCoursesByDay 按天分组、组内按节次升序、全字段关闭的行剔除', () => {
  const rows = [
    { week: 3, day: 3, sections: [5, 6], name: '大学物理', room: 'C303', teacher: '' },
    { week: 3, day: 1, sections: [3, 4], name: '高等数学', room: 'A101', teacher: '' },
    { week: 3, day: 1, sections: [1, 2], name: '大学英语', room: 'B202', teacher: '' },
    { week: 3, day: 1, sections: [6], name: '体育', room: '操场', teacher: '' },
  ]
  const all = { time: true, name: true, room: true }
  const groups = groupCoursesByDay(rows, all)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].label, '周一')
  assert.deepEqual(groups[0].rows.map((r) => r.name), ['大学英语', '高等数学', '体育'])
  assert.equal(groups[1].label, '周三')

  // 只开时间：每行只剩时间文案，没有课程名/教室占位
  const timeOnly = groupCoursesByDay(rows, { time: true, name: false, room: false })
  assert.equal(timeOnly.length, 2)
  assert.deepEqual(timeOnly[0].rows.map((r) => courseRowText(r, { time: true, name: false, room: false })), ['周一 第 1-2 节', '周一 第 3-4 节', '周一 第 6 节'])

  // 全字段关闭：连行都不出现
  assert.deepEqual(groupCoursesByDay(rows, { time: false, name: false, room: false }), [])
  assert.deepEqual(groupCoursesByDay([], all), [])
})

/* ===== 双人空间（P2-04b） ===== */

test('relationLabel 六种关系都有称呼，custom 用自定义，未知回退好友', () => {
  assert.equal(relationLabel('lover', ''), '恋人')
  assert.equal(relationLabel('brother', ''), '兄弟')
  assert.equal(relationLabel('buddy', ''), '死党')
  assert.equal(relationLabel('bestie', ''), '闺蜜')
  assert.equal(relationLabel('friend', ''), '好友')
  assert.equal(relationLabel('custom', '搭子'), '搭子')
  assert.equal(relationLabel('custom', ''), '好友')
  assert.equal(relationLabel('mystery', ''), '好友')
  assert.equal(RELATION_OPTIONS.length, 6)
})

test('normalizeRelationInput 收敛关系输入并清空非自定义的称呼', () => {
  assert.deepEqual(normalizeRelationInput('lover', '随便'), { relation: 'lover', label: '' })
  assert.deepEqual(normalizeRelationInput('custom', '  学习搭子  '), { relation: 'custom', label: '学习搭子' })
  assert.deepEqual(normalizeRelationInput('unknown', 'x'), { relation: 'friend', label: '' })
  assert.deepEqual(normalizeRelationInput('custom', '  '.repeat(3) + '超过十二个字的自定义称呼长度'), { relation: 'custom', label: '超过十二个字的自定义称呼' })
})

test('beijingDayNumber 按东八区日历日取整', () => {
  // 2026-11-13 16:00Z = 北京 14 日 0 点 → 北京日序与 2026-11-13 15:59Z（北京 13 日 23:59）相差 1
  const late = Date.UTC(2026, 10, 13, 15, 59, 0)
  const early = Date.UTC(2026, 10, 13, 16, 0, 0)
  assert.equal(beijingDayNumber(early) - beijingDayNumber(late), 1)
})

test('companionDays/Text 配对当天为第 1 天，跨午夜按北京时间进位', () => {
  // 配对时刻：2026-11-13 10:00Z（北京 13 日 18:00）
  const anniversary = '2026-11-13T10:00:00Z'
  const sameDay = Date.UTC(2026, 10, 13, 15, 0, 0) // 北京 13 日 23:00 → 当天
  const nextDay = Date.UTC(2026, 10, 13, 16, 1, 0) // 北京 14 日 00:01 → 已过 1 天
  assert.equal(companionDays(anniversary, sameDay), 0)
  assert.equal(companionDayText(anniversary, sameDay), '第 1 天')
  assert.equal(companionDays(anniversary, nextDay), 1)
  assert.equal(companionDayText(anniversary, nextDay), '第 2 天')
  assert.equal(companionDays('not-a-date', sameDay), -1)
  assert.equal(companionDayText('not-a-date', sameDay), '纪念日待确认')
  // 未来时刻（时钟回拨）不出现负天数
  const before = '2099-01-01T00:00:00Z'
  assert.equal(companionDays(before, sameDay), 0)
})

test('spaceFromJson 解析空间行，spaceDayText 区分相恋/相伴', () => {
  const space = spaceFromJson({
    id: 7,
    partner_uid: 'stu_00112233445566778899aabbccdd',
    side: 'social',
    relation: 'lover',
    relation_label: '',
    status: 'active',
    anniversary_at: '2026-11-13T10:00:00Z',
    updated_at: '2026-11-13T10:00:00Z',
  })
  assert.ok(space)
  assert.equal(space.relation, 'lover')
  assert.equal(space.relationLabel, '恋人')
  assert.equal(space.side, 'social')
  assert.equal(space.status, 'active')
  assert.match(spaceDayText(space, Date.UTC(2026, 10, 13, 15, 0, 0)), /^相恋天数 · 第 1 天$/)

  const buddy = spaceFromJson({ id: 8, partner_uid: 'u2', side: 'student', relation: 'buddy', status: 'active', anniversary_at: '2026-11-13T10:00:00Z' })
  assert.match(spaceDayText(buddy, Date.UTC(2026, 10, 13, 15, 0, 0)), /^相伴天数 · 第 1 天$/)
  assert.equal(spaceFromJson(null), null)
  const unknown = spaceFromJson({ id: 9, partner_uid: 'u3', relation: 'weird', anniversary_at: '' })
  assert.equal(unknown.relation, 'friend')
  assert.equal(unknown.relationLabel, '好友')
  assert.equal(unknown.anniversaryAt, '')
})

test('inviteRowFromJson 解析关系类型字段', () => {
  const row = inviteRowFromJson({ code: 'ABCD-EF23', used_count: 0, max_uses: 1, relation: 'custom', relation_label: '饭搭子' })
  assert.ok(row)
  assert.equal(row.relation, 'custom')
  assert.equal(row.relationLabel, '饭搭子')
})
