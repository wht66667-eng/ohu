#!/usr/bin/env node
/** Create an isolated Android source tree for F-Droid without changing the regular Android project. */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const incompatible = ['capgo-capacitor-updater', 'capacitor-freerasp']

export function removeFdroidIncompatibleAndroidRefs({ settings, capacitorBuild, rootBuild }) {
  const removeLine = (line) => {
    if (incompatible.some((name) => line.includes(name))) return true
    if (line.includes('talsec-artifact-repository')) return true
    if (/classpath\s+['"]com\.google\.gms:google-services:/.test(line)) return true
    return false
  }
  const transform = (text) => {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const next = text.split(/\r?\n/).filter((line) => !removeLine(line)).join(eol)
    return next.endsWith(eol) ? next : `${next}${eol}`
  }
  const result = {
    settings: transform(settings),
    capacitorBuild: transform(capacitorBuild),
    rootBuild: transform(rootBuild),
  }
  const remaining = Object.entries(result).filter(([, text]) =>
    incompatible.some((name) => text.includes(name)) ||
    text.includes('talsec-artifact-repository') ||
    text.includes('com.google.gms:google-services:'))
  if (remaining.length) throw new Error(`F-Droid incompatible references remain in: ${remaining.map(([name]) => name).join(', ')}`)
  return result
}

function copyAndroidTree(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter(path) {
      const rel = relative(from, path).split(sep).join('/')
      if (!rel) return true
      const parts = rel.split('/')
      if (parts.some((part) => part === '.gradle' || part === '.idea' || part === 'build' || part === 'keystore')) return false
      if (rel === 'local.properties' || rel === 'app/google-services.json') return false
      return true
    },
  })
}

export function prepareFdroidAndroidTree({ projectRoot = root } = {}) {
  const project = resolve(projectRoot)
  const from = join(project, 'android')
  const to = join(project, 'android-fdroid')
  const outputRel = relative(project, to)
  if (!outputRel || outputRel.startsWith(`..${sep}`) || resolve(project, outputRel) !== to || to === from) {
    throw new Error('拒绝清理项目目录外的 F-Droid 临时构建目录')
  }
  if (!existsSync(join(from, 'capacitor.settings.gradle')) || !existsSync(join(from, 'app', 'capacitor.build.gradle'))) {
    throw new Error('先执行 Capacitor sync，再生成 F-Droid Android 源码树')
  }
  // This output is a generated, disposable build copy. The normal Android source tree is never modified.
  if (existsSync(to)) rmSync(to, { recursive: true, force: true })
  copyAndroidTree(from, to)
  const settingsPath = join(to, 'capacitor.settings.gradle')
  const capacitorBuildPath = join(to, 'app', 'capacitor.build.gradle')
  const rootBuildPath = join(to, 'build.gradle')
  const transformed = removeFdroidIncompatibleAndroidRefs({
    settings: readFileSync(settingsPath, 'utf8'),
    capacitorBuild: readFileSync(capacitorBuildPath, 'utf8'),
    rootBuild: readFileSync(rootBuildPath, 'utf8'),
  })
  writeFileSync(settingsPath, transformed.settings)
  writeFileSync(capacitorBuildPath, transformed.capacitorBuild)
  writeFileSync(rootBuildPath, transformed.rootBuild)
  return to
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(prepareFdroidAndroidTree())
  } catch (error) {
    console.error(`[fdroid] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
