const { parentPort, workerData } = require('node:worker_threads')
const { checkDocx } = require('./parsers')

async function extract() {
  const buffer = Buffer.from(workerData.bytes)
  let text
  if (workerData.ext === 'docx') {
    checkDocx(buffer)
    text = (await require('mammoth').extractRawText({ buffer })).value
  } else {
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Invalid PDF')
    let pages = 0, characters = 0, rejected = false
    // This bundled PDF.js expects a plain Uint8Array; modern Node Buffers can be
    // misclassified as a document-parameter object and report a spurious xref error.
    const pdf = await require('pdf-parse')(new Uint8Array(buffer), { max: 0, pagerender: async page => {
      if (++pages > 50 || rejected) { rejected = true; throw new Error('PDF has too many pages') }
      let content
      try { content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }) }
      catch (error) { rejected = true; throw error }
      const value = content.items.map(item => item.str).join('\n')
      characters += value.length
      if (characters > 12000) { rejected = true; throw new Error('PDF has too much text') }
      return value
    } })
    // pdf-parse can swallow a page-render error; a sticky flag prevents partial-file billing.
    if (rejected || pdf.numpages > 50 || pages !== pdf.numpages || pdf.numrender !== pdf.numpages) throw new Error('PDF could not be read completely')
    text = pdf.text
  }
  if (typeof text !== 'string' || text.length > 12000) throw new Error('File has too much text')
  return text
}

extract().then(text => parentPort.postMessage({ ok: true, text }), () => parentPort.postMessage({ ok: false }))
