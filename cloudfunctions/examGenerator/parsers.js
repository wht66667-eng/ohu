const { TextDecoder } = require('node:util')
const { inflateRawSync } = require('node:zlib')
const { Worker } = require('node:worker_threads')

function availableFormats() {
  const formats = ['txt']
  for (const [format, packageName, version] of [['docx', 'mammoth', '1.8.0'], ['pdf', 'pdf-parse', '1.1.1']]) {
    try { if (require(`${packageName}/package.json`).version === version) formats.push(format) } catch { /* Absent parsers are never advertised. */ }
  }
  return formats
}

/** Reject ZIP expansion before passing a DOCX to the existing mammoth parser. */
function checkDocx(buffer) {
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('无效的 Word 文件')
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16), expanded = 0, document = false
  const directorySize = buffer.readUInt32LE(end + 12)
  if (!count || count > 1000 || buffer.readUInt16LE(end + 8) !== count || offset + directorySize !== end || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) throw new Error('无效的 Word 目录')
  const names = new Set()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('无效的 Word 文件')
    const length = buffer.readUInt16LE(offset + 28)
    const extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32)
    const size = buffer.readUInt32LE(offset + 24)
    if (size === 0xffffffff || (buffer.readUInt16LE(offset + 8) & 1)) throw new Error('不支持加密或 ZIP64 Word 文件')
    expanded += size
    if (expanded > 20 * 1024 * 1024 || offset + 46 + length + extra + comment > end) throw new Error('Word 解压内容过大')
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString('utf8')
    if (names.has(name) || /(^|\/)\.\.(\/|$)/.test(name)) throw new Error('无效的 Word 条目')
    names.add(name)
    const local = buffer.readUInt32LE(offset + 42), compressed = buffer.readUInt32LE(offset + 20)
    const method = buffer.readUInt16LE(offset + 10)
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 8) !== method || (buffer.readUInt16LE(local + 6) & 1)) throw new Error('无效的 Word 条目')
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    if (dataStart + compressed > buffer.readUInt32LE(end + 16) || ![0, 8].includes(method)) throw new Error('无效的 Word 压缩内容')
    const bytes = buffer.subarray(dataStart, dataStart + compressed)
    const inflated = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: Math.max(1, size) })
    if (inflated.length !== size) throw new Error('Word 条目大小校验失败')
    if (name === 'word/document.xml') document = true
    offset += 46 + length + extra + comment
  }
  if (offset !== end || !document) throw new Error('文件不是完整的 DOCX 文档')
}

async function parseFile(buffer, ext) {
  if (ext === 'txt') return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  if (!['docx', 'pdf'].includes(ext)) throw new Error('不支持的文件格式')
  return new Promise((resolve, reject) => {
    const worker = new Worker(require.resolve('./parse-worker'), { workerData: { bytes: buffer, ext },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('文件解析超时')), 10000)
    worker.once('error', error => finish(error))
    worker.once('exit', () => finish(new Error('文件解析中断')))
    worker.once('message', message => finish(message.ok ? null : new Error('文件解析失败'), message.text))
  })
}

module.exports = { availableFormats, parseFile, checkDocx }
