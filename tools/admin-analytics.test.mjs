/**
 * 管理端分析纯函数回归（admin-analytics-helpers）：日活序列补零、制裁剩余文案、活跃率，
 * 以及 TASK-C2 邀请码发放面板的直读行解析/文案/撤销口径。
 * 被测模块零副作用 import，Node 22+ 按类型擦除加载。
 * 运行：`node --test tools/admin-analytics.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatDayKey, fillDaySeries, sanctionRemainingText, kindLabel, activeRate,
  adminInviteRowFromJson, adminInviteActive, adminInviteRoleText, adminInviteUsageText,
  adminInviteExpiryText, adminInviteCanRevoke, adminInviteRevokeHint,
  adminInviteSummaryText, adminInviteUnavailableReason,
} from '../src/lib/admin-analytics-helpers.ts'

test('formatDayKey 输出本地 YYYY-MM-DD', () => {
  assert.equal(formatDayKey(new Date(2026, 10, 3).getTime()), '2026-11-03')
  assert.equal(formatDayKey(new Date(2026, 0, 9).getTime()), '2026-01-09')
})

test('fillDaySeries 缺失日补零且旧→新排列', () => {
  const now = Date.now()
  const today = formatDayKey(now)
  const yesterday = formatDayKey(now - 86_400_000)
  const rows = [{ day: today, active: 7 }]
  const series = fillDaySeries(rows, 3)
  assert.deepEqual(series, [
    { day: formatDayKey(now - 2 * 86_400_000), active: 0 },
    { day: yesterday, active: 0 },
    { day: today, active: 7 },
  ])
})

test('sanctionRemainingText 永久/过期/剩余分档', () => {
  assert.equal(sanctionRemainingText(null), '永久')
  assert.equal(sanctionRemainingText(undefined), '永久')
  assert.equal(sanctionRemainingText('not-a-date'), '未知')
  assert.equal(sanctionRemainingText(new Date(Date.now() - 1000).toISOString()), '已过期')
  assert.equal(sanctionRemainingText(new Date(Date.now() + 3 * 86_400_000).toISOString()), '剩余 3 天')
  assert.equal(sanctionRemainingText(new Date(Date.now() + 2 * 3_600_000).toISOString()), '剩余 2 小时')
  assert.equal(sanctionRemainingText(new Date(Date.now() + 30 * 60_000).toISOString()), '不足 1 小时')
})

test('kindLabel 三种制裁都有中文标签', () => {
  assert.equal(kindLabel('mute'), '禁言')
  assert.equal(kindLabel('hall_ban'), '封大厅')
  assert.equal(kindLabel('account'), '封账号')
  assert.equal(kindLabel('unknown'), 'unknown')
})

test('activeRate 上限 100 且零总量安全', () => {
  assert.equal(activeRate(30, 100), 30)
  assert.equal(activeRate(200, 100), 100)
  assert.equal(activeRate(5, 0), 0)
})

/* ===== TASK-C2 邀请码发放面板（直读 social_invites 行的纯解析与文案） ===== */

const DAY = 86_400_000

function row(overrides = {}) {
  return adminInviteRowFromJson({
    code: 'ABCD-EF23',
    created_by_uid: 'uid-admin-1',
    created_by_role: 'admin',
    used_count: 2,
    max_uses: null,
    used_by_uids: ['s1', 's2'],
    expires_at: new Date(Date.now() + 3 * DAY).toISOString(),
    relation: 'lover',
    relation_label: '',
    revoked: false,
    note: '给 QA 的码',
    created_at: '2026-11-14T00:00:00+08:00',
    ...overrides,
  })
}

test('adminInviteRowFromJson 解析直读行并复用关系称呼', () => {
  const inv = row()
  assert.ok(inv)
  assert.equal(inv.code, 'ABCD-EF23')
  assert.equal(inv.createdByRole, 'admin')
  assert.equal(inv.maxUses, null)
  assert.equal(inv.boundCount, 2)
  assert.equal(inv.relationLabel, '恋人')
  const custom = adminInviteRowFromJson({ code: 'X', relation: 'custom', relation_label: '搭子' })
  assert.equal(custom?.relationLabel, '搭子')
  const student = adminInviteRowFromJson({ code: 'Y', created_by_role: 'student', max_uses: 1, used_count: 1 })
  assert.equal(student?.maxUses, 1)
  assert.equal(student?.createdByRole, 'student')
  // 缺 code / 非对象行丢弃
  assert.equal(adminInviteRowFromJson({ created_by_uid: 'x' }), null)
  assert.equal(adminInviteRowFromJson(null), null)
  assert.equal(adminInviteRowFromJson('code'), null)
})

test('adminInviteActive 撤销/过期/用尽/不限次数四态', () => {
  const now = Date.now()
  assert.equal(adminInviteActive(row({}), now), true)
  assert.equal(adminInviteActive(row({ revoked: true }), now), false)
  assert.equal(adminInviteActive(row({ expires_at: new Date(now - 1000).toISOString() }), now), false)
  assert.equal(adminInviteActive(row({ max_uses: 1, used_count: 1 }), now), false)
  assert.equal(adminInviteActive(row({ max_uses: 1, used_count: 0 }), now), true)
})

test('adminInviteUsageText 撤销/过期/不限次数/限额文案', () => {
  const now = Date.now()
  assert.equal(adminInviteUsageText(row({ revoked: true }), now), '已撤销，不能再被绑定')
  assert.equal(adminInviteUsageText(row({ expires_at: new Date(now - 1000).toISOString() }), now), '已过期，不能再被绑定')
  assert.equal(adminInviteUsageText(row({}), now), '已绑定 2 人 · 不限次数')
  assert.equal(adminInviteUsageText(row({ max_uses: 1, used_count: 1 }), now), '名额已用尽（1/1）')
  assert.equal(adminInviteUsageText(row({ max_uses: 3, used_count: 1, used_by_uids: ['a'] }), now), '已绑定 1/3 人')
})

test('adminInviteExpiryText 天数分档（整天向下取整）且过期/撤销为空', () => {
  const now = Date.now()
  assert.equal(adminInviteExpiryText(row({ expires_at: new Date(now + 3 * DAY + 60_000).toISOString() }), now), '3 天后到期')
  assert.equal(adminInviteExpiryText(row({ expires_at: new Date(now + 2 * DAY - 60_000).toISOString() }), now), '明天到期')
  assert.equal(adminInviteExpiryText(row({ expires_at: new Date(now + 2 * 3_600_000).toISOString() }), now), '今天到期')
  assert.equal(adminInviteExpiryText(row({ expires_at: new Date(now - DAY).toISOString() }), now), '')
  assert.equal(adminInviteExpiryText(row({ revoked: true }), now), '')
})

test('adminInviteCanRevoke/RevokeHint 服务端只允许发放方撤销', () => {
  const mine = row({})
  const others = row({ created_by_uid: 'uid-someone-else', created_by_role: 'student' })
  const revoked = row({ revoked: true })
  assert.equal(adminInviteCanRevoke(mine, 'uid-admin-1'), true)
  assert.equal(adminInviteCanRevoke(others, 'uid-admin-1'), false)
  assert.equal(adminInviteCanRevoke(revoked, 'uid-admin-1'), false)
  assert.equal(adminInviteCanRevoke(mine, ''), false)
  assert.equal(adminInviteRevokeHint(mine, 'uid-admin-1'), '')
  assert.equal(adminInviteRevokeHint(others, 'uid-admin-1'), '仅发放方可撤销')
  assert.equal(adminInviteRevokeHint(revoked, 'uid-admin-1'), '已撤销')
})

test('adminInviteRoleText/SummaryText 面板列表文案', () => {
  const now = Date.now()
  assert.equal(adminInviteRoleText(row({})), '管理员码')
  assert.equal(adminInviteRoleText(row({ created_by_role: 'student' })), '学生码')
  assert.equal(adminInviteRoleText(row({ created_by_role: 'weird' })), '邀请码')
  const rows = [row({}), row({ revoked: true }), row({ created_by_role: 'student', max_uses: 1, used_count: 1 })]
  assert.equal(adminInviteSummaryText(rows, now), '共 3 枚 · 可绑定 1 · 已失效 2')
  assert.equal(adminInviteSummaryText([], now), '共 0 枚 · 可绑定 0 · 已失效 0')
})

test('adminInviteUnavailableReason 识别迁移未部署并给部署指引', () => {
  const hint = adminInviteUnavailableReason('Could not find the function social_invite_create in the schema cache')
  assert.ok(hint && hint.includes('docs/sql/social-invites-166.sql'))
  assert.ok(adminInviteUnavailableReason('relation "public.social_invites" does not exist')?.includes('尚未部署'))
  assert.ok(adminInviteUnavailableReason('42883: function not found'))
  assert.ok(adminInviteUnavailableReason('PGRST202'))
  // 其它错误原样返回 null（界面展示原始错误）
  assert.equal(adminInviteUnavailableReason('网络请求超时'), null)
  assert.equal(adminInviteUnavailableReason(null), null)
  assert.equal(adminInviteUnavailableReason(''), null)
})
