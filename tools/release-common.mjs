import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, rmdirSync, unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const RELEASE_SIGNER_SHA256 = '88b2c5dd74746c81b16031955880da26e04b516b45a8b5104d0c662c95e5fd12'

export function isWithin(parent, child, allowEqual = true) {
  const rel = relative(resolve(parent), resolve(child))
  return (allowEqual || rel !== '') && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/** Refuse lexical escapes and junction/symlink redirects before writing or deleting. */
export function assertOutputPath(sourceRoot, outputRoot, target = outputRoot) {
  const source = resolve(sourceRoot)
  const output = resolve(outputRoot)
  const destination = resolve(target)
  if (!isWithin(source, output, false) || !isWithin(output, destination)) {
    throw new Error(`Unsafe output path: ${destination}; expected a generated directory below ${output}`)
  }
  const physicalSource = realpathSync(source)
  const segments = relative(source, destination).split(sep).filter(Boolean)
  let current = source
  for (const segment of segments) {
    current = join(current, segment)
    if (!existsSync(current)) continue
    if (lstatSync(current).isSymbolicLink() || !isWithin(physicalSource, realpathSync(current), false)) {
      throw new Error(`Output path must not contain a symlink or junction: ${current}`)
    }
  }
  return destination
}

/** Delete only an explicitly scoped generated output. Never delete through a shell. */
export function clearOutput(sourceRoot, outputRoot, target = outputRoot) {
  const destination = assertOutputPath(sourceRoot, outputRoot, target)
  function removeEntry(path) {
    if (!isWithin(destination, path)) throw new Error(`Cleanup escaped its output: ${path}`)
    const stat = lstatSync(path)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of readdirSync(path)) removeEntry(join(path, name))
      rmdirSync(path)
    } else {
      // A link inside an output tree is unlinked; its destination is never traversed.
      unlinkSync(path)
    }
  }
  if (existsSync(destination)) removeEntry(destination)
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function copyImmutableFile(sourceRoot, outputRoot, from, to) {
  const target = assertOutputPath(sourceRoot, outputRoot, to)
  mkdirSync(dirname(target), { recursive: true })
  if (existsSync(target)) {
    if (sha256File(from) !== sha256File(target)) {
      throw new Error(`Refusing to replace an existing release artifact: ${target}. Use a new version/build.`)
    }
    return target
  }
  copyFileSync(from, target)
  return target
}

export function positiveInteger(value, label) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(value)
}

export function validateVersion(value) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value))) {
    throw new Error('Version must be a three-part version such as 1.2.122')
  }
  return String(value)
}

export function selectShells(value = 'both') {
  if (value === 'both') return ['user', 'admin']
  if (value === 'user' || value === 'admin') return [value]
  throw new Error('--shell must be user, admin, or both')
}

export function parseOptions(argv, values = [], flags = []) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]
    if (flags.includes(name)) result[name] = true
    else if (values.includes(name)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`)
      if (name in result) throw new Error(`Duplicate option ${name}`)
      result[name] = argv[++i]
    } else throw new Error(`Unknown option ${name}`)
  }
  return result
}

export function readReleaseIdentity(root = PROJECT_ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8')
  const version = validateVersion(pkg.version)
  const webSource = readFileSync(join(root, 'src/lib/app-version.ts'), 'utf8')
  const webVersion = validateVersion(webSource.match(/WEB_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1])
  const webBuild = positiveInteger(webSource.match(/WEB_BUILD\s*=\s*(\d+)/)?.[1], 'WEB_BUILD')
  if (webVersion !== version) throw new Error('package.json and src/lib/app-version.ts WEB_VERSION must match')
  const nativeVersion = validateVersion(gradle.match(/^\s*versionName\s+["']([^"']+)["']/m)?.[1])
  const nativeBuild = positiveInteger(gradle.match(/^\s*versionCode\s+(\d+)/m)?.[1], 'Android versionCode')
  return { version, webBuild, nativeVersion, nativeBuild }
}

export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(metaUrl)
}
