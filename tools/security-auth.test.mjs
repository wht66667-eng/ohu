import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 登录安全离线检查：
 * 1) 正方教务登录（学号 + 教务密码）已彻底下线：源码里不得再出现登录入口
 * 2) 停用的 campusAuth 云函数不得再提供建号 / 改密能力
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const sources = walk(join(root, 'src'))
assert.ok(sources.length > 100, '源码扫描应覆盖主要模块')

const forbidden = ['loginWithCampus', 'loginAppWithCampus', "from './CampusGate'"]
for (const token of forbidden) {
  const hit = sources.find((file) => fs.readFileSync(file, 'utf8').includes(token))
  assert.equal(hit, undefined, `正方教务登录残留：${token}${hit ? ` @ ${hit}` : ''}`)
}

// 学生端门禁必须是手机号注册 / 密码登录
const gate = fs.readFileSync(join(root, 'src/components/PhoneRegistrationGate.tsx'), 'utf8')
assert.match(gate, /手机号注册/)
assert.match(gate, /loginWithPassword/)
assert.equal(fs.existsSync(join(root, 'src/components/CampusGate.tsx')), false, '旧学号门禁组件不应存在')

const module = { exports: {} }
const serverSource = fs.readFileSync(join(root, 'cloudfunctions/campusAuth/index.js'), 'utf8')
vm.runInNewContext(serverSource, {
  module, exports: module.exports,
  require: () => { throw new Error('停用接口不得访问认证管理SDK') },
})
assert.equal((await module.exports.main({ httpMethod: 'OPTIONS' })).statusCode, 204)
const denied = await module.exports.main({ httpMethod: 'POST', body: '{}' })
assert.equal(denied.statusCode, 403)
assert.equal(JSON.parse(denied.body).ok, false)
assert.equal((await module.exports.main({})).ok, false)

assert.equal(serverSource.includes('/api/campus-auth'), false)
assert.equal(/modifyUser|createUser/.test(serverSource), false)
console.log('登录安全检查：正方教务登录已下线、门禁为手机号、停用云函数仍拒绝建号/改密；未联网、未调用真实账号。')
