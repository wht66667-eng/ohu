#!/usr/bin/env node
/** cap sync 后把 VERSION_21 / jvmToolchain(21) 改回 17，避免无 JDK 21 时编译失败。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const files = [
  join(root, 'android/app/capacitor.build.gradle'),
  join(root, 'android/capacitor-cordova-android-plugins/build.gradle'),
]

let n = 0
for (const f of files) {
  if (!existsSync(f)) continue
  const raw = readFileSync(f, 'utf8')
  let next = raw.replaceAll('JavaVersion.VERSION_21', 'JavaVersion.VERSION_17')
  next = next.replaceAll('jvmToolchain(21)', 'jvmToolchain(17)')
  if (next !== raw) {
    writeFileSync(f, next)
    n++
    console.log('[patch-java17]', f)
  }
}
console.log(`[patch-java17] done, files=${n}`)
