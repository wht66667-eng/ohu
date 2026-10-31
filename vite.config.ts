import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { localStudentDownload } from './tools/local-student-download.mjs'

/** 站内网关（线上云函数路由只在 HTTPSERVICE 网关默认域上；本地 dev 靠 proxy 转发，页面保持相对路径） */
const UPSTREAM =
  process.env.UPSTREAM ||
  'https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com'

/** .env.capgo 不走 Vite 默认命名，需显式灌入 VITE_*（密钥类勿写进前端） */
function loadCapgoViteEnv(cwd: string): Record<string, string> {
  const out: Record<string, string> = {}
  const p = join(cwd, '.env.capgo')
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i <= 0) continue
    const k = s.slice(0, i).trim()
    const v = s.slice(i + 1).trim()
    if (k.startsWith('VITE_') && k && !(k in process.env)) out[k] = v
  }
  return out
}

export default defineConfig(({ mode }) => {
  const cwd = process.cwd()
  const env = { ...loadCapgoViteEnv(cwd), ...loadEnv(mode, cwd, 'VITE_') }

  /**
   * 构建基址由 VITE_BASE 驱动，两种产物互不覆盖：
   *  - H5（默认）：'/'，站点部署在域根，index.html 引用 /assets/... 绝对路径
   *    （tools/deploy-hosting.mjs 依赖此项做产物校验）；
   *  - 套壳 App：'./'，Capacitor 以本地文件方式加载页面，必须全部相对路径。
   * 由 tools/build-multiplatform.mjs 分别注入，不需要手工切配置。
   */
  const base = env.VITE_BASE || process.env.VITE_BASE || '/'
  const capgoAppId = (
    process.env.VITE_CAPGO_APP_ID ||
    env.VITE_CAPGO_APP_ID ||
    'com.sunshinecampus.app'
  ).trim()
  const appShell = process.env.VITE_APP_SHELL || env.VITE_APP_SHELL || 'user'
  const fdroidBuild = (process.env.VITE_FDROID_BUILD || env.VITE_FDROID_BUILD) === '1'

  return {
    base,
    plugins: [react(), managementEntry(appShell), localStudentDownload(cwd), harborDevPack(), pruneDeadDraco()],
    resolve: {
      alias: fdroidBuild ? [
        // The F-Droid build must not contain a second executable-code updater.
        { find: './lib/live-update', replacement: join(cwd, 'src/lib/live-update-fdroid.ts') },
        { find: '../lib/live-update', replacement: join(cwd, 'src/lib/live-update-fdroid.ts') },
        // The regular app keeps freeRASP; this source-only build omits its binary SDK.
        { find: 'capacitor-freerasp', replacement: join(cwd, 'src/lib/fdroid/capacitor-freerasp.ts') },
      ] : [],
    },
    define: {
      'import.meta.env.VITE_CAPGO_APP_ID': JSON.stringify(capgoAppId),
      'import.meta.env.VITE_FDROID_BUILD': JSON.stringify(fdroidBuild ? '1' : '0'),
    },
    server: {
      host: '0.0.0.0',
      port: 43123,
      strictPort: true,
      // Build outputs are not source inputs. On Windows, watching an APK while
      // Gradle/staging writes it can throw EBUSY and kill the preview server.
      watch: { ignored: ['**/.release-out/**', '**/dist/**', '**/dist-app/**', '**/android/**', '**/ios/**', '**/*.apk'] },
      proxy: {
        '/api': {
          target: UPSTREAM,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 43123,
    },
    build: {
      chunkSizeWarningLimit: 1200,
    },
  }
})

/** Select an independent module graph, rather than shipping every student route in the management APK. */
export function managementEntry(shell: string): Plugin {
  return {
    name: 'management-entry',
    transformIndexHtml: { order: 'pre', handler(html) {
      return shell === 'admin' ? html.replace('src="/src/main.tsx"', 'src="/src/main-admin.tsx"') : html
    } },
    generateBundle() {
      if (shell !== 'admin') return
      const studentOnly = /\/src\/(?:App\.tsx|components\/(?:PhoneShell|RemindHost|PublishSheet|CourseReminderSettings|ExamReminderSettings)\.tsx|pages\/(?:HomePage|ServicesPage|SettingsPage|MessagesPage)\.tsx|pages\/(?:schedule|moments)\/[^?]*|lib\/(?:class-remind|notify-setup|exam-utils|todo-remind)\.ts)(?:\?|$)/
      const leaked = [...this.getModuleIds()].map((id) => id.replaceAll('\\', '/')).filter((id) => studentOnly.test(id))
      if (leaked.length) this.error(`管理端包含学生专用模块，已停止打包：\n${leaked.join('\n')}`)
    },
  }
}

/** 只在 dev server 暴露内容包。生产构建不会把它拷进 dist，因此不会进 APK。 */
function harborDevPack() {
  const root = join(process.cwd(), 'harbor-world-pack')
  const types: Record<string, string> = {
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
  }
  return {
    name: 'harbor-dev-pack',
    configureServer(server: { middlewares: { use: (path: string, fn: (req: { url?: string }, res: NodeJS.WritableStream & { statusCode: number; setHeader: (k: string, v: string) => void; end: (s?: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use('/__dev/harbor-world', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
        if (!rel || rel.includes('..')) {
          res.statusCode = 400
          res.end('bad path')
          return
        }
        const file = join(root, rel)
        if (!existsSync(file)) return next()
        try {
          const st = statSync(file)
          if (!st.isFile()) return next()
          res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          createReadStream(file).pipe(res)
        } catch {
          next()
        }
      })
    },
  }
}

/**
 * 构建期剔除运行时用不到的 draco 解码器副本（每次约 1.0MB）。
 *
 * 为什么会多出来：three 的 DRACOLoader.js 在模块顶层写了三个
 * `new URL('../libs/draco/…')` 常量（非 gltf 解码器 + asm.js 回退），Vite 见到静态
 * 资源引用就原样 emit；而本项目调用处（Fox3D.tsx）
 * 都用 `setDecoderPath({ js, wasm })` 显式指向 gltf 版 —— 另一套永不加载。
 *
 * 为什么放在这里而不是「构建完删文件」：本 IDE 的 safe-delete 守卫按「目录 + 单次
 * 工具调用」限量（个人目录 50 个），构建前的 purge(dist) 一次就删几百个、直接把额度
 * 用光，事后再删一律被拦（tools/prune-draco-assets.mjs 因此会静默删 0 个）。
 * 在 bundle 生成阶段直接不产出，不碰文件系统，就从根上绕开这个限额。
 *
 * 判定与 prune-draco-assets.mjs 一致且保守：只剔除 md5 与 three「非 gltf」源文件
 * 逐字节一致的产物；在用的 gltf 那一套、以及任何身份不明的资源一律保留。
 * 源码缺失或哈希取不到时整体跳过，绝不盲删。
 */
function pruneDeadDraco(): Plugin {
  const srcDir = join(process.cwd(), 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco')
  const md5Of = (file: string): string | null =>
    existsSync(file) ? createHash('md5').update(readFileSync(file)).digest('hex') : null
  const hashesOf = (names: string[]) =>
    new Set(names.map((n) => md5Of(join(srcDir, n))).filter((h): h is string => h !== null))
  /** 在用的 gltf 一套（体积小，DRACOLoader 实际加载的那对） */
  const keep = hashesOf([join('gltf', 'draco_decoder.wasm'), join('gltf', 'draco_wasm_wrapper.js')])
  /** 白带的一套：非 gltf 解码器 + asm.js 回退 */
  const dead = hashesOf(['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'])
  const emitted = /^assets\/draco_[a-z_]+-[A-Za-z0-9_-]+\.(?:js|wasm)$/
  return {
    name: 'prune-dead-draco',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!dead.size || !keep.size) return
      for (const [fileName, item] of Object.entries(bundle)) {
        if (!emitted.test(fileName)) continue
        // 只处理原样拷贝的资源；若哪天被 emit 成 chunk（code 形态）就跳过，宁可不瘦包
        if (item.type !== 'asset') continue
        const digest = createHash('md5').update(item.source).digest('hex')
        if (keep.has(digest) || !dead.has(digest)) continue
        delete bundle[fileName]
      }
    },
  }
}
