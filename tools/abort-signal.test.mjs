import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { withTimeout } from '../src/lib/abort-signal.ts'

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('withTimeout：外部取消会同步中止', () => {
  const controller = new AbortController()
  const signal = withTimeout(controller.signal, 5_000)
  controller.abort()
  assert.equal(signal.aborted, true)
})

test('withTimeout：超时会中止', async () => {
  const signal = withTimeout(undefined, 20)
  await tick(60)
  assert.equal(signal.aborted, true)
})

test('withTimeout：WebView 没有 AbortSignal.any 时仍能合并取消', () => {
  const original = AbortSignal.any
  try {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true })
    const controller = new AbortController()
    const signal = withTimeout(controller.signal, 5_000)
    controller.abort()
    assert.equal(signal.aborted, true)
  } finally {
    Object.defineProperty(AbortSignal, 'any', { value: original, configurable: true })
  }
})

test('全仓只在 abort-signal.ts 里使用 AbortSignal.any', () => {
  const root = new URL('../src/', import.meta.url)
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  walk(root)
  const offenders = files
    .filter((file) => !file.pathname.endsWith('/abort-signal.ts'))
    .filter((file) => readFileSync(file, 'utf8').includes('AbortSignal.any'))
  assert.deepEqual(offenders.map((file) => file.pathname), [])
})