/**
 * 海洋狐狸风 · 成套素材批量生成（豆包 Seedream 4.x 图生图）
 *
 * 用法（PowerShell）：
 *   $env:ARK_API_KEY="你的方舟APIKey"; node tools/gen-fox-assets.mjs
 *   只跑某一个 job：node tools/gen-fox-assets.mjs --only=mascot/hero-wave.png
 *   覆盖重出：加 --force；换模型：$env:ARK_MODEL="doubao-seedream-4-5-..."
 *
 * 输出：design/sunny-fox/gen/
 * 注意：产物是**设计稿**，不放 public/ —— public 会被整拷进 dist，
 *       曾让 OTA 包凭空多出 2.2MB 且运行时从未用到（1280 已清理，见 docs/优化清单-已完成与待办.md）。
 * 说明：4.x 不支持 seed（仅 3.0 文生图支持），角色一致性靠参考图锁定。
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'design', 'sunny-fox', 'gen')
const FORCE = process.argv.includes('--force')
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)

// 以 Downloads 里的 4 张设计图作为角色 / 风格参考（锁同一只狐狸）
const REF_FILES = [
  'C:/Users/upwar/Downloads/校园服务首页·海洋狐狸风.png',
  'C:/Users/upwar/Downloads/服务列表页·海洋狐狸风.png',
  'C:/Users/upwar/Downloads/专注计时与学习统计页·海洋狐狸风.png',
  'C:/Users/upwar/Downloads/海洋太阳狐狸App核心UI三屏.png',
]

const MODEL = process.env.ARK_MODEL || 'doubao-seedream-4-0-250828'
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'

const STYLE =
  '3D卡通厚涂插画，与参考图完全相同的同一只橙黄色小狐狸：黑色圆框眼镜、蓝色水手领巾、胸前金色太阳徽章、大圆眼睛、毛发柔和高光、蓬松大尾巴；左上45°柔光，高饱和海蓝与暖橙配色，画面干净精致，无任何文字、字母、水印、logo'

// size 必须满足总像素 ≥ 3,686,400
const JOBS = [
  { f: 'mascot/hero-wave.png', size: '2048x2048', transparent: true, refs: [0, 3],
    p: `${STYLE}。小狐狸七分身居中构图，开心地挥一只爪子打招呼，另一只手夹着蓝白条纹游泳圈，站姿，纯透明背景，主体四周留白10%` },
  { f: 'mascot/focus-peek.png', size: '2048x2048', transparent: true, refs: [2],
    p: `${STYLE}。小狐狸从画面下方一个巨大的透明蓝色玻璃水球圆环后探出上半身，举爪握拳做加油动作，兴奋张嘴笑，纯透明背景，主体居中偏下，上方留白` },
  { f: 'mascot/point.png', size: '2048x2048', transparent: true, refs: [1],
    p: `${STYLE}。小狐狸半身，开心地侧身伸出一只爪子指向画面右侧做介绍推荐姿势，另一只手握拳在胸前，纯透明背景，主体偏左，右侧留白` },
  { f: 'mascot/cheer.png', size: '2048x2048', transparent: true, refs: [0, 3],
    p: `${STYLE}。小狐狸全身站姿，双爪举起欢呼跳跃，开怀大笑，尾巴翘起，纯透明背景，主体居中四周留白10%` },
  { f: 'mascot/sit-surf.png', size: '2048x2048', transparent: true, refs: [0],
    p: `${STYLE}。小狐狸坐在沙滩上，旁边立着一块蓝白冲浪板，眨眼微笑竖起一只爪子比赞，纯透明背景，主体居中四周留白10%` },
  { f: 'scene/sea-hero.jpg', size: '1600x2848', transparent: false, refs: [0],
    p: '夏日海边竖版场景背景：上方明亮蓝天、发光的大太阳、白云与海鸥，远处小岛上有红白灯塔、棕榈树，海面上黄色小帆船，中部清澈浅蓝海面，底部米色沙滩、浪花、海星与贝壳；卡通厚涂风格，与参考图一致，画面中不要出现任何角色或狐狸，无文字水印，构图疏朗适合UI叠加' },
  { f: 'scene/deepsea.jpg', size: '1600x2848', transparent: false, refs: [2],
    p: '深海水下竖版场景背景：顶部透下柔和的蓝色光束与缓缓上升的气泡，画面中央区域保持简洁深蓝色调留白以便叠加计时器，底部沙地、彩色珊瑚、紫色礁石、海星、海草与几条小型热带鱼；卡通厚涂风格，与参考图一致，无角色无狐狸，无文字水印' },
  { f: 'scene/beach-banner.jpg', size: '2848x1600', transparent: false, refs: [0],
    p: '海边校园横版场景背景横幅：左侧远处中式教学楼与绿树，中间蓝色海面上白色小帆船，右侧沙滩上有沙堡与棕榈树，明亮夏日阳光，蓝天白云；卡通厚涂风格，与参考图一致，无角色无狐狸，无文字水印，右侧留出干净区域便于叠加文字' },
]

function dataUri(p) {
  const ext = extname(p).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`
}

async function callArk(job, refs, tryTransparent) {
  const body = {
    model: MODEL,
    prompt: job.p,
    image: refs,
    size: job.size,
    response_format: 'b64_json',
    output_format: job.f.endsWith('.jpg') ? 'jpeg' : 'png',
    watermark: false,
    sequential_image_generation: 'disabled',
  }
  if (tryTransparent) {
    body.background = 'transparent'
  }
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ARK_API_KEY}` },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} ${text.slice(0, 400)}`)
    err.status = r.status
    err.body = text
    throw err
  }
  const j = JSON.parse(text)
  const item = j.data?.[0]
  if (item?.b64_json) return { buf: Buffer.from(item.b64_json, 'base64'), transparent: tryTransparent }
  if (item?.url) return { buf: Buffer.from(await (await fetch(item.url)).arrayBuffer()), transparent: tryTransparent }
  throw new Error('返回中无图片数据：' + text.slice(0, 400))
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms))

async function main() {
  if (!process.env.ARK_API_KEY) {
    console.error('✗ 未设置 ARK_API_KEY。PowerShell: $env:ARK_API_KEY="你的Key"; node tools/gen-fox-assets.mjs')
    process.exit(1)
  }
  const present = REF_FILES.filter((p) => existsSync(p))
  const refUris = present.map(dataUri)
  if (refUris.length === 0) {
    console.error('✗ 没找到参考图，请确认 Downloads 下 4 张设计图存在')
    process.exit(1)
  }
  const jobs = ONLY ? JOBS.filter((j) => basename(j.f) === basename(ONLY) || j.f === ONLY) : JOBS
  console.log(`参考图 ${refUris.length}/4 · 模型 ${MODEL} · 共 ${jobs.length} 张`)

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    const out = join(OUT, job.f)
    if (existsSync(out) && !FORCE) {
      console.log(`• ${i + 1}/${jobs.length} ${job.f} 已存在，跳过（--force 覆盖）`)
      continue
    }
    process.stdout.write(`→ ${i + 1}/${jobs.length} ${job.f} ... `)
    try {
      const refs = [...new Set(job.refs ?? [0])].map((k) => refUris[k]).filter(Boolean)
      let res
      try {
        res = await callArk(job, refs, job.transparent)
      } catch (e) {
        // 透明背景要求输入图带 alpha，实底参考图会 400，自动回退实底再本地抠图
        if (job.transparent && e.status === 400) {
          process.stdout.write(`(透明底被拒→实底回退) `)
          res = await callArk(job, refs, false)
        } else {
          throw e
        }
      }
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, res.buf)
      console.log(`OK ${res.transparent ? '[透明]' : '[实底]'} (${(res.buf.length / 1024).toFixed(0)}KB)`)
    } catch (e) {
      console.log(`失败：${e.message}`)
    }
    await sleep(1200)
  }
  console.log('\n完成。检查 design/sunny-fox/gen/ 下图片（确认无误后再自行复制进 public/ 并加入引用）。')
}
main()
