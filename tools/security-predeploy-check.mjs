#!/usr/bin/env node
/**
 * 上线前安全验收（本地静态检查）
 * 用法：npm run security:check
 *
 * 退出码：有 FAIL → 1；仅 WARN → 0（仍打印警告）
 * 不扫描公网、不改服务器；云安全组 / 端口扫描见 SECURITY_CHECKLIST.md
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const fails = []
const warns = []
const oks = []

function ok(msg) {
  oks.push(msg)
}
function warn(msg) {
  warns.push(msg)
}
function fail(msg) {
  fails.push(msg)
}

function read(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

function walk(dir, pred, acc = [], depth = 0) {
  if (depth > 8 || !existsSync(dir)) return acc
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const name = e.name
    if (
      name === 'node_modules' ||
      name === '.codex' || // Local QA tool environments are not application source or release assets.
      name === '.git' ||
      name === 'dist' ||
      name === 'dist-app' ||
      name === 'dist-deploy' ||
      name === 'android' ||
      name === 'ios' ||
      name === 'design' ||
      name === '.hosting-upload' ||
      name === '.ota-out'
    ) {
      continue
    }
    const full = join(dir, name)
    if (e.isDirectory()) walk(full, pred, acc, depth + 1)
    else if (pred(full, name)) acc.push(full)
  }
  return acc
}

const SECRET_KEY_RE =
  /^(?:.*_)?(?:API[_-]?KEY|SECRET|PASSWORD|PRIVATE[_-]?KEY|ACCESS[_-]?TOKEN|JWT[_-]?SECRET|DATABASE_URL|CLOUDBASE_API_KEY|CAPGO_API_KEY|TIM_SECRET|OPENAI_API_KEY|DEEPSEEK_API_KEY|AWS_SECRET)(?:_.*)?$/i

const HARDCODE_RE =
  /(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{30,}|xox[baprs]-[a-zA-Z0-9-]{20,})/

const DANGEROUS_DOCKER_RE =
  /privileged\s*:\s*true|network_mode\s*:\s*['"]?host|\/:\/host|cap_add\s*:\s*\[[^\]]*SYS_ADMIN/i

/** 1) .gitignore 覆盖密钥文件 */
function checkGitignore() {
  const gi = read(join(ROOT, '.gitignore'))
  const need = ['.env.capgo', 'CLOUDBASE_API_KEY', 'TIM_SECRET', 'keystore']
  for (const n of need) {
    if (gi.includes(n)) ok(`.gitignore 覆盖 ${n}`)
    else fail(`.gitignore 未覆盖 ${n}`)
  }
  if (!gi.includes('.env*.local') && !gi.includes('.env.local')) {
    warn('.gitignore 建议忽略 .env*.local')
  }
}

/** 2) 被 git 跟踪的 env / 凭证文件 */
function checkTrackedSecrets() {
  let tracked = ''
  try {
    tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  } catch {
    warn('无法执行 git ls-files，跳过跟踪文件检查')
    return
  }
  const lines = tracked.split(/\r?\n/).filter(Boolean)
  const bad = lines.filter(
    (f) =>
      /(^|\/)\.env\.capgo$/i.test(f) ||
      /CLOUDBASE_API_KEY/i.test(f) ||
      /TIM_SECRET/i.test(f) ||
      /\.jks$/i.test(f) ||
      /keystore\/.+\.(jks|keystore)$/i.test(f) ||
      /local-secret/i.test(f) ||
      /\.capgo-credentials/i.test(f),
  )
  if (bad.length) fail(`疑似密钥文件已被 git 跟踪：${bad.join(', ')}`)
  else ok('未发现被跟踪的明显密钥文件（.env.capgo / keystore / TIM_SECRET 等）')

  const envTracked = lines.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example'))
  for (const f of envTracked) {
    const body = read(join(ROOT, f))
    const keys = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.split('=')[0].replace(/^\uFEFF/, '').trim())
    const secretish = keys.filter((k) => SECRET_KEY_RE.test(k) && !k.startsWith('VITE_'))
    const viteSecret = keys.filter((k) => k.startsWith('VITE_') && SECRET_KEY_RE.test(k.replace(/^VITE_/, '')))
    if (secretish.length) fail(`${f} 被跟踪且含敏感键：${secretish.join(', ')}`)
    else if (viteSecret.length) fail(`${f} 被跟踪且 VITE_ 疑似密钥键：${viteSecret.join(', ')}`)
    else ok(`已跟踪 ${f} 仅含公开配置键：${keys.join(', ') || '(空)'}`)
  }
}

/** 3) 本地 .env* 中的 VITE_ 密钥风险 */
function checkEnvViteLeak() {
  const envFiles = walk(ROOT, (full, name) => name.startsWith('.env') && !name.endsWith('.example'))
  for (const f of envFiles) {
    const rel = relative(ROOT, f)
    for (const line of read(f).split(/\r?\n/)) {
      const s = line.trim()
      if (!s || s.startsWith('#') || !s.includes('=')) continue
      const key = s.split('=')[0].replace(/^\uFEFF/, '').trim()
      if (!key.startsWith('VITE_')) continue
      const bare = key.slice(5)
      if (SECRET_KEY_RE.test(bare) || /SECRET|PASSWORD|PRIVATE|TOKEN|DATABASE/i.test(bare)) {
        fail(`${rel} 含可能打进前端包的密钥键：${key}`)
      }
    }
  }
  ok('已扫描本地 .env* 的 VITE_* 键名')
}

/** 4) 源码硬编码疑似密钥 */
function checkHardcoded() {
  const files = walk(
    ROOT,
    (full, name) =>
      /\.(ts|tsx|js|mjs|cjs|py|json|yml|yaml|env|md)$/i.test(name) &&
      !name.endsWith('.example') &&
      !full.includes(`${join('prompts')}`),
  )
  let hits = 0
  for (const f of files) {
    const rel = relative(ROOT, f)
    if (rel.startsWith('SECURITY_CHECKLIST') || rel.includes('security-predeploy')) continue
    const text = read(f)
    if (!text || text.length > 2_000_000) continue
    if (HARDCODE_RE.test(text)) {
      hits += 1
      fail(`${rel} 疑似硬编码云厂商/Token 形态密钥`)
    }
    // 赋值形态：const X_SECRET = '...'
    if (/(?:API_KEY|SECRET|PASSWORD)\s*[:=]\s*['"][^'"]{12,}['"]/i.test(text) && !rel.includes('.example')) {
      // 排除明显占位
      if (!/your[_-]?key|changeme|xxx|placeholder|example/i.test(text)) {
        hits += 1
        warn(`${rel} 存在疑似明文密钥赋值（请人工确认是否占位符）`)
      }
    }
  }
  if (!hits) ok('源码未发现典型硬编码密钥形态')
}

/** 5) Docker / compose 危险配置 */
function checkDocker() {
  const dockerFiles = walk(
    ROOT,
    (full, name) =>
      /^Dockerfile/i.test(name) ||
      /^docker-compose/i.test(name) ||
      name.endsWith('.compose.yml') ||
      name.endsWith('.compose.yaml'),
  )
  if (!dockerFiles.length) {
    warn('未找到 Dockerfile / compose（若只用云托管面板，请人工核对运行用户与端口）')
    return
  }
  for (const f of dockerFiles) {
    const rel = relative(ROOT, f)
    const text = read(f)
    if (DANGEROUS_DOCKER_RE.test(text)) fail(`${rel} 含 privileged / host 网络 / 危险挂载`)
    else ok(`${rel} 未见 privileged/host/根挂载`)

    if (/^Dockerfile/i.test(rel.split(/[\\/]/).pop() || '')) {
      if (/^\s*USER\s+/m.test(text) && !/^\s*USER\s+root\s*$/im.test(text)) {
        ok(`${rel} 已设置非 root USER`)
      } else {
        fail(`${rel} 未设置非 root USER（或以 root 运行）`)
      }
      if (/FROM\s+\S+:latest/i.test(text)) warn(`${rel} 使用 :latest 标签，建议固定版本`)
      if (!/mem_limit|deploy:\s*\n\s*resources|cpus/i.test(text)) {
        warn(`${rel} 未在文件内声明资源限制（可在编排/云托管侧限制 CPU/内存）`)
      }
    }
  }
}

/** 6) CORS * */
function checkCors() {
  const files = walk(ROOT, (full, name) => /\.(ts|tsx|js|mjs|py)$/i.test(name))
  let active = 0
  let legacy = 0
  for (const f of files) {
    const text = read(f)
    if (
      /Access-Control-Allow-Origin['"\s:=]+['"]\*['"]/i.test(text) ||
      /cors\(\s*\{\s*origin\s*:\s*true/i.test(text) ||
      /origin\s*:\s*['"]\*['"]/i.test(text)
    ) {
      const rel = relative(ROOT, f)
      const isLegacy = /old-cf|_verify|design-refs|\.codetmp/i.test(rel)
      if (isLegacy) {
        legacy += 1
        warn(`${rel}（遗留目录）CORS * — 确认未再部署即可`)
      } else {
        active += 1
        fail(`${rel} 存在 CORS 全开放（*）— 建议改为安全域名白名单 / 回显可信 Origin`)
      }
    }
  }
  if (!active && !legacy) ok('源码未见 CORS `*` 全开放写法')
  else if (!active) ok('活跃路径未见 CORS *（仅遗留目录有警告）')
}

/** 7) 打包产物抽查 */
function checkDistLeak() {
  const distDirs = ['dist', 'dist-app', 'dist-deploy'].map((d) => join(ROOT, d)).filter(existsSync)
  if (!distDirs.length) {
    warn('无 dist* 目录，跳过打包产物抽查（可先 build 再跑）')
    return
  }
  const secretNames = ['CAPGO_API_KEY', 'CLOUDBASE_API_KEY', 'TIM_SECRET', 'JWT_SECRET', 'DATABASE_URL']
  for (const dir of distDirs) {
    const files = walk(dir, (full, name) => /\.(js|mjs|css|html|json|map)$/i.test(name), [], 0)
    // walk skips dist — search manually
    const stack = [dir]
    const found = []
    while (stack.length) {
      const cur = stack.pop()
      let ents = []
      try {
        ents = readdirSync(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of ents) {
        const full = join(cur, e.name)
        if (e.isDirectory()) stack.push(full)
        else if (/\.(js|mjs|html|json|map)$/i.test(e.name) && statSync(full).size < 5_000_000) found.push(full)
      }
    }
    let leak = 0
    for (const f of found.slice(0, 400)) {
      const text = read(f)
      for (const name of secretNames) {
        if (text.includes(name + '=') || text.includes(`"${name}"`) || text.includes(`'${name}'`)) {
          // 键名出现不一定是值；再看硬编码形态
          if (HARDCODE_RE.test(text) || new RegExp(`${name}["']?\\s*[:=]\\s*["'][^"']{8,}`, 'i').test(text)) {
            leak += 1
            fail(`${relative(ROOT, f)} 打包产物疑似含 ${name}`)
          }
        }
      }
      if (HARDCODE_RE.test(text)) {
        leak += 1
        fail(`${relative(ROOT, f)} 打包产物含疑似 Token 形态字符串`)
      }
    }
    if (!leak) ok(`${relative(ROOT, dir)} 抽查未见明显密钥泄露`)
  }
}

/** 8) 管理入口 / 默认口令痕迹 */
function checkAdminDefaults() {
  const files = walk(ROOT, (full, name) => /\.(ts|tsx|js|mjs|py)$/i.test(name))
  for (const f of files) {
    const text = read(f)
    if (/password\s*[:=]\s*['"](?:admin|123456|password|root)['"]/i.test(text)) {
      fail(`${relative(ROOT, f)} 疑似默认弱密码硬编码`)
    }
  }
  ok('未见 admin/123456 等默认口令硬编码')
}

function printReport() {
  console.log('\n=== 阳光校园 · 上线前安全检查 ===\n')
  for (const m of oks) console.log(`  OK   ${m}`)
  for (const m of warns) console.log(`  WARN ${m}`)
  for (const m of fails) console.log(`  FAIL ${m}`)
  console.log('\n--------------------------------')
  console.log(`通过 ${oks.length} · 警告 ${warns.length} · 失败 ${fails.length}`)
  console.log('完整清单与人工项：SECURITY_CHECKLIST.md')
  console.log('AI 审计 Prompt：prompts/security-audit-deploy.md\n')
  if (fails.length) {
    console.log('结论：暂缓上线（存在 FAIL）\n')
    process.exitCode = 1
  } else if (warns.length) {
    console.log('结论：可继续，但请处理 WARN 并完成公网端口/安全组人工验收\n')
  } else {
    console.log('结论：静态检查通过；仍需人工核对防火墙、端口扫描、备份与 2FA\n')
  }
}

checkGitignore()
checkTrackedSecrets()
checkEnvViteLeak()
checkHardcoded()
checkDocker()
checkCors()
checkDistLeak()
checkAdminDefaults()
printReport()
