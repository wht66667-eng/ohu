import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { assertOutputPath, copyImmutableFile, sha256File } from './release-common.mjs'

/** Only a same-version, hash-verified unsigned student IPA may enter the public website bundle. */
export function verifiedIosDownload(root, identity) {
  const manifestPath = join(root, 'public/download/ios-latest.json')
  if (!existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest?.status !== 'available') return null
  const filename = manifest.filename
  if (manifest.app !== '哦狐' || manifest.platform !== 'ios' || manifest.shell !== 'user' || manifest.signed !== false
    || manifest.version !== identity.nativeVersion || manifest.build !== identity.nativeBuild
    || typeof filename !== 'string' || basename(filename) !== filename || !filename.toLowerCase().endsWith('.ipa')
    || manifest.url !== `/download/${filename}`
    || !/^[a-f0-9]{64}$/i.test(manifest.sha256) || !Number.isSafeInteger(manifest.size) || manifest.size < 1) return null
  const source = assertOutputPath(root, join(root, 'public/download'), join(root, 'public/download', filename))
  if (!existsSync(source)) throw new Error('iOS release manifest points to a missing IPA')
  const actual = statSync(source)
  if (!actual.isFile() || actual.size !== manifest.size || sha256File(source).toLowerCase() !== manifest.sha256.toLowerCase()) {
    throw new Error('iOS IPA size or SHA-256 does not match its release manifest')
  }
  return { source, manifest }
}

export function stageVerifiedIosDownload(root, output, identity) {
  const verified = verifiedIosDownload(root, identity)
  if (!verified) return null
  const target = join(output, verified.manifest.url.slice(1))
  copyImmutableFile(root, output, verified.source, target)
  return target
}
