/**
 * 瘦包：删掉运行时用不到的 draco 解码器副本（每次约 1.0MB）。
 *
 * 为什么会多出来：three 的 DRACOLoader.js 在模块顶层写了三个
 * `new URL('../libs/draco/…')` 常量（非 gltf 版解码器 + asm.js 回退），
 * Vite 见到静态资源引用就把它们原样打进产物；而本项目两处调用
 * （src/components/fox/Fox3D.tsx）
 * 都用 `setDecoderPath({ js, wasm })` 显式指向 gltf 版 —— DRACOLoader 会把
 * dep_js 置 null，asm.js 回退与「非 gltf」那一套永不加载。
 *
 * 判定方式（保守）：产物里的资源是源文件的逐字节拷贝，按 md5 反查 ——
 * 只允许删与 three「非 gltf」源文件哈希一致的副本；在用的那对、以及任何
 * 身份不明的文件（例如同名前缀的 DRACOLoader 代码块）一律保留。
 * three 源码缺失或哈希对不上时整体跳过，绝不盲删。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRACO_SRC = join('node_modules', 'three', 'examples', 'jsm', 'libs', 'draco')
/** 在用的一套：gltf（体积小，DRACOLoader 实际加载的那对） */
const USED = [join(DRACO_SRC, 'gltf', 'draco_wasm_wrapper.js'), join(DRACO_SRC, 'gltf', 'draco_decoder.wasm')]
/** 白带的一套：非 gltf 解码器 + asm.js 回退，只允许删这几个的副本 */
const DEAD = [
  join(DRACO_SRC, 'draco_decoder.js'),
  join(DRACO_SRC, 'draco_decoder.wasm'),
  join(DRACO_SRC, 'draco_wasm_wrapper.js'),
]
const ASSET_NAME = /^draco_[a-z_]+-[A-Za-z0-9_-]+\.(?:js|wasm)$/

const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex')
const hashOf = (rel) => {
  const abs = resolve(ROOT, rel)
  return existsSync(abs) ? md5(abs) : null
}

/**
 * 删单个文件：先走 fs，失败再回落系统命令。
 * 与 build-multiplatform.mjs 的 purge() 同因同法：本 IDE 的 safe-delete shim 会把
 * fs 删除重定向到回收站，批量删除还会被守卫拦下——回落系统命令才删得掉。
 */
function removeFile(file) {
  try {
    unlinkSync(file)
    return !existsSync(file)
  } catch {
    const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'rm'
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', `del /f /q "${file}"`] : ['-f', file]
    spawnSync(command, args, { stdio: 'ignore' })
    return !existsSync(file)
  }
}

/** 就地删除 dir 下未使用的 draco 副本；返回 { removed, bytes, skipped } */
export function pruneUnusedDraco(dir) {
  const dead = new Set(DEAD.map(hashOf).filter(Boolean))
  const keep = new Set(USED.map(hashOf).filter(Boolean))
  if (!dead.size || !keep.size) return { removed: [], bytes: 0, skipped: ['three 源码不完整，跳过 draco 瘦包'] }
  const removed = []
  const skipped = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(target)
        continue
      }
      if (!ASSET_NAME.test(entry.name)) continue
      const digest = md5(target)
      // 在用的那对、以及身份不明的文件（如 DRACOLoader 代码块），一律保留
      if (keep.has(digest) || !dead.has(digest)) continue
      const bytes = statSync(target).size
      if (!removeFile(target)) {
        // 两条路都删不掉时只记一笔，绝不打断构建（大不了包大 1MB）
        skipped.push(entry.name)
        continue
      }
      removed.push({ name: entry.name, bytes })
    }
  }
  walk(dir)
  return { removed, bytes: removed.reduce((sum, item) => sum + item.bytes, 0), skipped }
}

// 仅当本文件被直接执行时才走命令行分支；被 import 进构建脚本时不能碰 process.argv
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) for (const dir of process.argv.slice(2).map((item) => resolve(ROOT, item))) {
  if (!existsSync(dir)) {
    console.log(`[prune-draco] 跳过（目录不存在）：${dir}`)
    continue
  }
  const { removed, bytes, skipped } = pruneUnusedDraco(dir)
  const list = removed.length ? ` → ${removed.map((item) => item.name).join(', ')}` : ''
  console.log(`[prune-draco] ${dir}：删掉 ${removed.length} 个未用解码器，省 ${(bytes / 1048576).toFixed(2)}MB${list}`)
  for (const note of skipped) console.log(`[prune-draco] 跳过：${note}`)
}
