/**
 * 从 https://petdex.dev/api/manifest 拉取指定 slug 到 public/pets/imported/
 * 保留原始 pet.json，不改写作者 metadata。
 *
 *   node tools/import-petdex-packs.mjs
 *   node tools/import-petdex-packs.mjs --slugs=a,b,c
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'

const DEFAULT_SLUGS = [
  'lulu-capybara-2',
  'big-orange-cat',
  'white-dog',
  'blue-button-bunny',
  'shiba-4',
  'momo-bunny',
  'climber-cat',
  'ray-bunny',
]

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, { headers: { 'User-Agent': 'sunshine-campus-petdex-import/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject)
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} ${url}`))
        else resolve(Buffer.concat(chunks))
      })
    })
    req.on('error', reject)
  })
}

const arg = process.argv.find((a) => a.startsWith('--slugs='))
const slugs = arg ? arg.slice('--slugs='.length).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SLUGS
const root = path.resolve('public/pets/imported')
fs.mkdirSync(root, { recursive: true })

const manifest = JSON.parse((await get('https://petdex.dev/api/manifest')).toString('utf8'))
const pets = manifest.pets || manifest
const index = []

for (const slug of slugs) {
  const p = pets.find((x) => x.slug === slug)
  if (!p) {
    console.warn('MISS', slug)
    continue
  }
  const dir = path.join(root, slug)
  fs.mkdirSync(dir, { recursive: true })
  const jsonBuf = await get(p.petJsonUrl)
  fs.writeFileSync(path.join(dir, 'pet.json'), jsonBuf)
  const sheetBuf = await get(p.spritesheetUrl)
  fs.writeFileSync(path.join(dir, 'spritesheet.webp'), sheetBuf)
  let pj = {}
  try {
    pj = JSON.parse(jsonBuf.toString('utf8'))
  } catch {
    console.warn('bad pet.json', slug)
  }
  fs.writeFileSync(
    path.join(dir, 'SOURCE.json'),
    JSON.stringify(
      {
        source: 'petdex',
        slug: p.slug,
        displayName: p.displayName,
        kind: p.kind,
        submittedBy: p.submittedBy,
        importedAt: new Date().toISOString(),
        petJsonUrl: p.petJsonUrl,
        spritesheetUrl: p.spritesheetUrl,
        licenseNote:
          'Pet assets remain owned by their submitters. Not Official Campus Fox IP. Do not rewrite pet.json.',
      },
      null,
      2,
    ),
  )
  index.push({
    slug,
    displayName: p.displayName,
    submittedBy: p.submittedBy,
    kind: p.kind,
    nameFromJson: pj.displayName || pj.name || p.displayName,
    description: pj.description || '',
    localPetJson: `pets/imported/${slug}/pet.json`,
    localSpritesheet: `pets/imported/${slug}/spritesheet.webp`,
  })
  console.log('OK', slug, `${Math.round(sheetBuf.length / 1024)}KB`)
}

fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index, null, 2))
fs.writeFileSync(
  path.join(root, 'ATTRIBUTION.md'),
  `# Imported Petdex packs

Gallery: https://petdex.dev  
Manifest: https://petdex.dev/api/manifest  
Upstream: https://github.com/crafter-station/petdex (platform MIT; assets owned by submitters)

## Packs

${index.map((x) => `- \`${x.slug}\` — ${x.displayName} (by ${x.submittedBy})`).join('\n')}

## Rules

1. Keep original \`pet.json\` bytes — never overwrite author metadata.
2. Credit \`submittedBy\` in UI.
3. Not Official Campus Fox IP.
`,
)
console.log('wrote', index.length, 'packs →', root)
