import test from 'node:test'
import assert from 'node:assert/strict'
import { isPathAllowedForShell } from '../src/lib/shell-path-policy.ts'
import { hasWorkAccess } from '../src/lib/work-access.ts'

test('student admin routes deny by default and allow trusted admin or superadmin flags', () => {
  for (const path of ['/admin', '/admin/content', '/admin/members']) {
    assert.equal(isPathAllowedForShell('user', path), false)
    assert.equal(isPathAllowedForShell('user', path, { isAdmin: false, isSuperAdmin: false }), false)
    assert.equal(isPathAllowedForShell('user', path, { isAdmin: true }), true)
    assert.equal(isPathAllowedForShell('user', path, { isSuperAdmin: true }), true)
  }
  assert.equal(isPathAllowedForShell('user', '/administrator'), true)
  assert.equal(isPathAllowedForShell('user', '/study/focus'), true)
})

test('admin shell keeps its own admin paths and cannot enter student study pages', () => {
  assert.equal(isPathAllowedForShell('admin', '/admin/content'), true)
  assert.equal(isPathAllowedForShell('admin', '/admin/members'), true)
  assert.equal(isPathAllowedForShell('admin', '/study'), false)
  assert.equal(isPathAllowedForShell('admin', '/plaza'), false)
})

test('admin admission requires a signed account with admin or superadmin flag', () => {
  const base = { shell: 'admin', isSigned: true, isAdmin: false }
  assert.equal(hasWorkAccess(base), false)
  assert.equal(hasWorkAccess({ ...base, isAdmin: true }), true)
  assert.equal(hasWorkAccess({ ...base, isSuperAdmin: true }), true)
  assert.equal(hasWorkAccess({ ...base, isSigned: false, isAdmin: true }), false)
})
