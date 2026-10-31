import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateFocusMusic, isFocusMusicRecord, readFocusMusic, FOCUS_MUSIC_LIMIT } from '../src/lib/focus-music.ts'
import { clampFocusVolume, loadFocusVolume, saveFocusVolume, loadFocusOptions, saveFocusOptions, isFocusAudioSource } from '../src/lib/focus-settings.ts'

test('music import accepts the supported audio formats and rejects empty, oversize and disguised video files', () => {
  for (const [name, type] of [['课间.mp3', 'audio/mpeg'], ['音乐.m4a', 'audio/mp4'], ['雨声.wav', 'audio/wav'], ['本地.ogg', 'audio/ogg'], ['纯音乐.flac', 'audio/flac'], ['音频.mp3', '']]) assert.equal(validateFocusMusic({ name, type, size: 128 }), null)
  assert.match(validateFocusMusic({ name: '空.mp3', type: 'audio/mpeg', size: 0 }), /文件为空/)
  assert.match(validateFocusMusic({ name: '大.mp3', type: 'audio/mpeg', size: FOCUS_MUSIC_LIMIT + 1 }), /50 MB/)
  assert.match(validateFocusMusic({ name: '伪装.mp3', type: 'video/mp4', size: 128 }), /不能导入视频/)
  assert.match(validateFocusMusic({ name: '不支持.amr', type: 'audio/amr', size: 128 }), /MP3/)
})
test('corrupted persisted local music and invalid IDs are rejected', async () => {
  const valid = { id: '12345678-1234-1234-1234-123456789abc', name: '学习音乐', size: 4, type: 'audio/mpeg', importedAt: Date.now(), duration: 25, blob: new Blob(['abcd']) }
  assert.equal(isFocusMusicRecord(valid), true)
  for (const record of [null, { ...valid, id: 'bad-id' }, { ...valid, blob: {} }, { ...valid, size: 20 }, { ...valid, duration: -1 }, { ...valid, importedAt: 'invalid' }]) assert.equal(isFocusMusicRecord(record), false)
  assert.equal(await readFocusMusic('blob:transient-id'), null)
  assert.equal(await readFocusMusic('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), null)
})
test('volume defaults to fifteen percent and always stays within zero to fifty percent', () => {
  const disk = new Map()
  globalThis.localStorage = { getItem: (key) => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) }
  assert.equal(loadFocusVolume(), .15)
  assert.equal(saveFocusVolume(.25), .25)
  assert.equal(loadFocusVolume(), .25)
  assert.equal(clampFocusVolume(-5), 0)
  assert.equal(clampFocusVolume(1), .5)
  assert.equal(clampFocusVolume(Infinity), .15)
  assert.equal(clampFocusVolume(NaN), .15)
  disk.set('focus.audio.volume.v1', 'not-a-number')
  assert.equal(loadFocusVolume(), .15)
})
test('audio options persist local IDs and HTTPS links without accepting temporary object URLs', () => {
  const disk = new Map()
  globalThis.localStorage = { getItem: (key) => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) }
  const initial = loadFocusOptions()
  assert.equal(initial.noise, 'off')
  const local = 'local:12345678-1234-1234-1234-123456789abc'
  saveFocusOptions({ ...initial, noise: local })
  assert.equal(loadFocusOptions().noise, local)
  assert.equal(isFocusAudioSource('https://example.com/music.mp3'), true)
  assert.equal(isFocusAudioSource('https://'), false)
  saveFocusOptions({ ...initial, noise: 'blob:temporary-url' })
  assert.equal(loadFocusOptions().noise, 'off')
  assert.equal(disk.get('focus.options.v2').includes('blob:'), false)
})
