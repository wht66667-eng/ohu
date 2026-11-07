import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import AdmZip from 'adm-zip'

const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.argv[2]) throw new Error('Pass the plugin delivery directory')
const output = resolve(process.argv[2])
mkdirSync(output, { recursive: true })
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(join(root, 'src/plugins/plugin-manifest.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports })
const manifest = module.exports.BUILT_IN_PLUGINS.find(row => row.id === 'fox-safety-library')
if (!manifest) throw new Error('Missing registered plugin')
const zip = new AdmZip()
for (const name of [
  'src/plugins/builtin/FoxSafety.tsx', 'src/plugins/fox-safety.ts', 'src/plugins/fox-safety-bank-loader.ts',
  'src/plugins/data/fox-safety-bank.json', 'src/pages/plugins/FoxSafetyPage.tsx', 'src/pages/plugins/fox-safety.module.css',
  'public/plugin-licenses/fox-safety-Apache-2.0.txt', 'docs/plugins/fox-safety.md', 'tools/fox-safety.test.mjs',
]) zip.addFile(name, readFileSync(join(root, name)))
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
zip.addFile('README.md', Buffer.from('# fox 安全知识 · 哦狐静态源码插件\n\n本插件已接入当前哦狐工作区。使用：服务 → 哦狐插件 → fox 安全知识 → 启用 → 打开离线题库。\n\n这个 ZIP 用于源码审核和接入，不是供 APK 动态下载执行的安装文件。迁移到另一份哦狐源码时，应登记 manifest.json 到插件清单、将 FoxSafety 加入 registry.ts，登记 /plugins/fox-safety 路由，并按 docs/plugins/fox-safety.md 增加最小数据权限。原目录的可选 fox-safety-extra-bank.json 不在此包内；使用者可以在插件页自行本机导入。\n\n完整来源、许可、数据格式和验证边界见 docs/plugins/fox-safety.md。\n'))
const path = join(output, `fox-safety-ohu-plugin-${manifest.version}.zip`)
const bytes = zip.toBuffer()
writeFileSync(path, bytes)
writeFileSync(path + '.sha256.txt', createHash('sha256').update(bytes).digest('hex') + '\n')
console.log(JSON.stringify({ path, files: zip.getEntryCount(), bytes: bytes.length }))
