import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_NAVIGATION, activeAdminNavigation } from '../src/lib/admin-navigation.ts'

test('browser management navigation keeps all current operations accessible', () => {
  assert.deepEqual(ADMIN_NAVIGATION.map((item) => item.path), [
    '/admin/content', '/admin/news', '/admin/reports', '/admin/members', '/admin/messages', '/admin/settings',
  ])
  assert.equal(new Set(ADMIN_NAVIGATION.map((item) => item.path)).size, ADMIN_NAVIGATION.length)
})

test('nested management pages retain the matching navigation item without prefix collisions', () => {
  assert.equal(activeAdminNavigation('/admin/news/')?.path, '/admin/news')
  assert.equal(activeAdminNavigation('/admin/content/review/42')?.path, '/admin/content')
  assert.equal(activeAdminNavigation('/admin/newspaper'), undefined)
  assert.equal(activeAdminNavigation('/admin/membership'), undefined)
  assert.equal(activeAdminNavigation('/study'), undefined)
})

test('existing management message destinations keep a coherent active navigation', () => {
  for (const path of ['/messages', '/chats', '/chats/42', '/im/thread', '/notify', '/chat']) {
    assert.equal(activeAdminNavigation(path)?.path, '/admin/messages', path)
  }
  assert.equal(activeAdminNavigation('/settings')?.path, '/admin/settings')
  assert.equal(activeAdminNavigation('/settings/account')?.path, '/admin/settings')
  assert.equal(activeAdminNavigation('/chatbot'), undefined)
})
