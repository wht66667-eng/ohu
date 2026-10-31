#!/usr/bin/env node
/** Compatibility entry. Releases live below .release-out; the source directory is never cleared. */
import { main } from './release-android.mjs'

console.log('[release] Legacy delivery entry now prepares the two Android APKs in .release-out/apk.')
try {
  main({ argv: ['--shell', 'both', ...process.argv.slice(2)] })
} catch (error) {
  console.error(`[release] ${error.message}`)
  process.exitCode = 1
}

