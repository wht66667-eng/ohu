import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`
const packageRows = []

for (const [lockPath, lockEntry] of Object.entries(lock.packages ?? {})) {
  if (!lockPath.startsWith('node_modules/')) continue
  const manifestPath = join(root, lockPath, 'package.json')
  let manifest = {}
  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch {}
  }
  const packagePath = join(root, lockPath)
  const licenseFiles = existsSync(packagePath)
    ? readdirSync(packagePath).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name)).sort()
    : []
  const licenseValue = manifest.license ?? lockEntry.license
  packageRows.push({
    name: manifest.name || lockPath.slice('node_modules/'.length),
    version: manifest.version || lockEntry.version || '',
    license: typeof licenseValue === 'string' ? licenseValue : licenseValue ? JSON.stringify(licenseValue) : '',
    licenseFiles: licenseFiles.join('; '),
    category: lockEntry.dev ? 'development/build' : 'production or shared',
    path: lockPath,
  })
}

packageRows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const packageCsv = [
  ['name', 'version', 'license_metadata', 'license_files_at_package_root', 'lockfile_category', 'package_path'].join(','),
  ...packageRows.map(row => [row.name, row.version, row.license, row.licenseFiles, row.category, row.path].map(csvCell).join(',')),
].join('\n') + '\n'

const publicRoot = join(root, 'public')
const assetRows = []
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) walk(fullPath)
    else if (entry.isFile()) {
      assetRows.push({
        path: relative(root, fullPath).replaceAll('\\', '/'),
        bytes: statSync(fullPath).size,
        extension: entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase() : '(none)',
      })
    }
  }
}
walk(publicRoot)
assetRows.sort((a, b) => a.path.localeCompare(b.path))
const assetCsv = [
  ['path', 'bytes', 'extension', 'provenance_and_redistribution_rights'].join(','),
  ...assetRows.map(row => [row.path, row.bytes, row.extension, 'NEEDS_MANUAL_SOURCE_AND_LICENSE_CONFIRMATION'].map(csvCell).join(',')),
].join('\n') + '\n'

const licenseCounts = new Map()
for (const row of packageRows) {
  const key = row.license || '(missing license metadata)'
  licenseCounts.set(key, (licenseCounts.get(key) ?? 0) + 1)
}
const missingLicense = packageRows.filter(row => !row.license)
const missingRootLicenseFile = packageRows.filter(row => !row.licenseFiles)
const publicByExtension = new Map()
for (const row of assetRows) publicByExtension.set(row.extension, (publicByExtension.get(row.extension) ?? 0) + 1)

writeFileSync(join(root, 'docs/release/fdroid-npm-licenses.csv'), packageCsv, 'utf8')
writeFileSync(join(root, 'docs/release/fdroid-public-assets.csv'), assetCsv, 'utf8')
const report = [
  '# F-Droid 依赖与素材许可盘点（自动初筛）',
  '',
  `生成日期：${new Date().toISOString().slice(0, 10)}。此报告只帮助逐项核验，不构成法律意见或许可证兼容结论。`,
  '',
  '## npm 锁定依赖',
  '',
  `- 锁文件版本：${lock.lockfileVersion}；记录包数：${packageRows.length}。分类是 lockfile 的 dev 标记，不能代替最终 APK 的依赖闭包。`,
  `- 缺少许可证元数据：${missingLicense.length} 个。`,
  `- 包根目录未发现常见 LICENSE/COPYING/NOTICE 文件名：${missingRootLicenseFile.length} 个；需查看包实际文件和上游许可。`,
  '- 完整包名、版本、元数据、常见许可文件名和 lockfile 分类见 [`fdroid-npm-licenses.csv`](./fdroid-npm-licenses.csv)。',
  '',
  '| package.json license 元数据 | 锁定包数 |',
  '|---|---:|',
  ...[...licenseCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([license, count]) => `| \`${license.replaceAll('|', '\\|')}\` | ${count} |`),
  '',
  '### 缺失许可元数据',
  '',
  ...(missingLicense.length ? missingLicense.map(row => `- \`${row.name}@${row.version}\` (${row.path})`) : ['- 无。']),
  '',
  '## `public/` 素材与静态文件',
  '',
  `- 文件数：${assetRows.length}。完整路径、大小和扩展名见 [fdroid-public-assets.csv](./fdroid-public-assets.csv)。每项目前均标记为待人工确认来源和再分发权；程序不能仅凭文件名判定版权。`,
  '',
  '| 扩展名 | 文件数 |',
  '|---|---:|',
  ...[...publicByExtension.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ext, count]) => `| \`${ext}\` | ${count} |`),
  '',
  '## 尚不能据此宣称合规',
  '',
  '- 根仓库许可证仍需著作权人明确选择，并确认共同贡献者授权。',
  '- npm 元数据可能不完整、错误或存在多许可证选项；每个最终构建依赖仍需核验其上游许可证、许可证正文、NOTICE 义务及实际进入 APK 的闭包。',
  '- 静态资源的作者、来源、商用／再分发授权和署名条件尚未由扫描器确认；尤其要逐项核对品牌、狐狸插画、宣传图、字体、地图与词库。',
  '- 后端服务和外部 API 的自由软件状态、服务可替换性及需要申报的 Anti-Features，仍须单独进行人工评估。',
  '- F-Droid buildserver 干净构建和复现验证仍未执行。',
  '',
].join('\n')
writeFileSync(join(root, 'docs/release/F-DROID-LICENSE-INVENTORY.md'), report, 'utf8')

console.log(JSON.stringify({ packages: packageRows.length, missingLicenseMetadata: missingLicense.length, packagesWithoutCommonLicenseFile: missingRootLicenseFile.length, publicFiles: assetRows.length }, null, 2))
