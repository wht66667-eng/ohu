import test from 'node:test'
import assert from 'node:assert/strict'
import { adminScopedPath, isAdminWorkspacePath, shouldOpenDesktopAdmin } from '../src/lib/client-surface.ts'

test('desktop browser starts administration while native and mobile students keep their home', () => {
  assert.equal(shouldOpenDesktopAdmin({ native: false, pathname: '/', width: 1440 }), true)
  for (const options of [
    { native: true, pathname: '/', width: 1440 },
    { native: false, pathname: '/', width: 390 },
    { native: false, pathname: '/schedule', width: 1440 },
    { native: false, pathname: '/', width: 1440, studentPreview: true },
  ]) assert.equal(shouldOpenDesktopAdmin(options), false)
})
test('shared messages retain their protected web management context and query', () => {
  assert.equal(adminScopedPath('/chats/42?from=inbox', '/admin/messages', false), '/admin/chats/42?from=inbox')
  assert.equal(adminScopedPath('/settings?section=account', '/admin/content', false), '/admin/settings?section=account')
  assert.equal(adminScopedPath('/', '/admin/content', false), '/admin/content')
  assert.equal(adminScopedPath('/admin/news', '/admin/content', false), '/admin/news')
})
test('native paths, student routes, external targets and prefix collisions are not rewritten', () => {
  assert.equal(adminScopedPath('/messages', '/admin/content', true), '/messages')
  assert.equal(adminScopedPath('/chats/42', '/messages', false), '/chats/42')
  for (const target of ['https://example.org/', '//example.org/', '#section', '?tab=all']) assert.equal(adminScopedPath(target, '/admin/content', false), target)
  assert.equal(isAdminWorkspacePath('/administrator'), false)
})
