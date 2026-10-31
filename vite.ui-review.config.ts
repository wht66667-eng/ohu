/** NON-PRODUCTION: explicit isolated review entry, no upstream proxy and no environment files. */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(root, 'tools/ui-review-fixtures.tsx')
const homeFixture = resolve(root, 'tools/ui-review-home-fixtures.tsx')
const reminderFixture = resolve(root, 'tools/ui-review-reminder-fixtures.tsx')
const messageFixture = resolve(root, 'tools/ui-review-message-fixtures.tsx')
const replacements = new Set(['auth', 'qbank', 'timetable', 'schedule-prefs', 'schedule-credentials', 'auto-sync', 'chat-image', 'stickers', 'cb'].map(name => resolve(root, `src/lib/${name}`).replaceAll('\\', '/')))
const reminderReplacements = new Set(['class-remind', 'exam-utils', 'reminder-presentation', 'reminder-boot', 'reminder-plan', 'reminder-overlay', 'reminder-self-test', 'keep-alive'].map(name => resolve(root, `src/lib/${name}`).replaceAll('\\', '/')))
const homeReplacements = new Set(['todo', 'weather'].map(name => resolve(root, `src/lib/${name}`).replaceAll('\\', '/')))
const messageReplacements = new Set(['notify', 'market', 'chat', 'chat-image', 'bulletin', 'friends'].map(name => resolve(root, `src/lib/${name}`).replaceAll('\\', '/')))
homeReplacements.add(resolve(root, 'src/pages/home/home-data').replaceAll('\\', '/'))
function isolatedFixtures(): Plugin {
  return {
    name: 'explicit-non-production-ui-fixtures', enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@capacitor/local-notifications') return resolve(root, 'tools/ui-review-notification-bridge.ts')
      if (!importer || !source.startsWith('.') || [fixture, homeFixture, reminderFixture, messageFixture].some(file => importer.split('?')[0].replaceAll('\\', '/') === file.replaceAll('\\', '/'))) return
      const path = resolve(dirname(importer.split('?')[0]), source).replaceAll('\\', '/').replace(/\.(tsx?|jsx?)$/, '')
      if (messageReplacements.has(path)) return messageFixture
      if (replacements.has(path)) return fixture
      if (homeReplacements.has(path)) return homeFixture
      if (reminderReplacements.has(path)) return reminderFixture
      if (path === resolve(root, 'src/lib/platform').replaceAll('\\', '/') && /\/(ReminderDisplaySettings|CourseReminderSettings|ExamReminderSettings)\.tsx(?:\?|$)/.test(importer.replaceAll('\\', '/'))) return reminderFixture
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url || '/').split('?')[0]
        if (path === '/') { response.statusCode = 302; response.setHeader('Location', '/ui-review-preview.html'); response.end(); return }
        if (path.endsWith('.html') && path !== '/ui-review-preview.html') { response.statusCode = 404; response.end('This isolated origin serves only the labelled local UI review entry.'); return }
        next()
      })
    },
  }
}
export default defineConfig({ root, envDir: false, envPrefix: 'NON_PRODUCTION_UI_REVIEW_', plugins: [isolatedFixtures(), react()],
  server: { host: '127.0.0.1', port: 43127, strictPort: true },
  build: { outDir: '.ui-review-dist', emptyOutDir: false, rollupOptions: { input: resolve(root, 'ui-review-preview.html') } },
})
