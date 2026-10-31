/**
 * 打包交付目录 → Desktop\新建文件夹 (6)
 * - 五端：免责声明 / 说明书 / APK / H5（注入壳）/ 小程序说明
 * - 总览：架构、注意事项、隐私协议副本
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(process.cwd())
const OUT = resolve(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', '新建文件夹 (6)')
const VER = '1.2.19'
const APK_SRC = resolve(process.env.USERPROFILE || '', 'Desktop', '5duan')

const SHELLS = [
  { id: 'user', label: '学生端', apk: `SunshineCampus-User-${VER}.apk`, home: '/' },
  { id: 'admin', label: '管理端', apk: `SunshineCampus-Admin-${VER}.apk`, home: '/admin/roles' },
  { id: 'rider', label: '骑手端', apk: `SunshineCampus-Rider-${VER}.apk`, home: '/work/rider' },
  { id: 'shop', label: '商家端', apk: `SunshineCampus-Shop-${VER}.apk`, home: '/work/shop' },
  { id: 'stall', label: '档口端', apk: `SunshineCampus-Stall-${VER}.apk`, home: '/work/stall' },
]

function ensureDir(p) {
  mkdirSync(p, { recursive: true })
}

function copyTree(src, dest) {
  ensureDir(dest)
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    if (statSync(from).isDirectory()) copyTree(from, to)
    else copyFileSync(from, to)
  }
}

function injectShell(indexHtml, shellId) {
  const snip = `<script>window.__SC_SHELL__=${JSON.stringify(shellId)};</script>`
  if (indexHtml.includes('window.__SC_SHELL__')) {
    return indexHtml.replace(/window\.__SC_SHELL__\s*=\s*['"]?\w+['"]?\s*;?/, `window.__SC_SHELL__=${JSON.stringify(shellId)};`)
  }
  if (indexHtml.includes('<head>')) return indexHtml.replace('<head>', `<head>\n    ${snip}`)
  return snip + indexHtml
}

const DISCLAIMER = {
  user: `# 阳光校园 · 学生端免责声明

> 包名：\`com.sunshinecampus.app\` · 版本 ${VER}  
> 适用：在校同学（学号 + 正方教务密码）

## 1. 服务性质
本应用提供校园生活信息撮合与学业辅助，**不替代**学校官方教务、学工、财务等系统。课表 / 成绩 / 考试以教务系统为准。

## 2. 数据与密码
- 教务密码可选「记住」后仅存本机（混淆存储），用于课表同步与 App 账号登录尝试。
- 请勿在公用设备勾选记住密码；因个人保管不善导致的损失由用户自行承担。

## 3. 交易与内容
二手、互助、食堂、小店等由用户与入驻方自行履约；平台提供技术服务，不对商品质量、配送结果作担保。禁止违法违规、欺诈、侵权内容。

## 4. 可选下载
精灵冒险包、港城游戏馆等为**手动下载**内容，不随 APK 安装；下载与使用须遵守应用内说明与版权要求。

## 5. 责任限制
因网络、教务系统、第三方支付 / 云服务故障导致的服务中断或数据延迟，平台在法律允许范围内免责。继续使用即视为同意本声明及《用户协议》《隐私政策》。
`,
  admin: `# 阳光校园 · 管理端免责声明

> 包名：\`com.sunshinecampus.admin\` · 版本 ${VER}  
> 适用：经授权的管理员 / 站长（手机号登录）

## 1. 权限边界
本端仅供授权运营人员。越权操作将被服务端拒绝。站长账号不得外借。

## 2. 操作责任
审核、内容治理、财务与成员治理影响真实用户与资金，操作人须按制度留痕并对误操作负责。

## 3. 数据合规
处理用户举报、订单与提现信息时须遵守最小必要原则与保密义务，不得用于与平台运营无关的目的。

## 4. 责任限制
因网络或云服务异常导致的短暂不可用不构成违约；故意或重大过失除外。继续使用即视为同意本声明。
`,
  rider: `# 阳光校园 · 骑手端免责声明

> 包名：\`com.sunshinecampus.rider\` · 版本 ${VER}  
> 适用：已通过审核的配送骑手（手机号登录）

## 1. 履约责任
接单即承诺按时取送；货损、延误由骑手与用户协商处理。禁止私下加价、转单牟利。

## 2. 安全
请遵守交通法规。平台不对交通事故或人身损害承担责任。

## 3. 位置信息
位置权限用于派单与履约辅助，可随时在系统中关闭（可能影响接单）。

## 4. 责任限制
继续使用即视为同意本声明及骑手服务相关条款。
`,
  shop: `# 阳光校园 · 商家端免责声明

> 包名：\`com.sunshinecampus.shop\` · 版本 ${VER}  
> 适用：楼栋小店商家（手机号登录）

## 1. 经营主体
商家为独立经营主体，对商品质量、价格、售后负首要责任。平台提供展示与订单撮合。

## 2. 合规
须保证资质真实；禁止违禁品与虚假宣传。平台有权下架或暂停店铺。

## 3. 结算
线上支付按第三方支付与平台结算规则执行；纠纷由买卖双方协商，平台可提供必要协助。

## 4. 责任限制
继续使用即视为同意本声明及商家入驻协议。
`,
  stall: `# 阳光校园 · 档口端免责声明

> 包名：\`com.sunshinecampus.stall\` · 版本 ${VER}  
> 适用：食堂档口店主（手机号登录）

## 1. 食品安全
档口须遵守校园餐饮卫生与食品安全规定，对出品质量负责。

## 2. 营业状态
请及时维护营业时段、强制打烊与公告，避免无法履约的订单。

## 3. 平台措施
违规档口可能被暂停营业或下架菜品。

## 4. 责任限制
继续使用即视为同意本声明及档口入驻规则。
`,
}

const MANUAL = {
  user: `# 阳光校园 · 学生端说明书

版本 **${VER}** · APK：\`SunshineCampus-User-${VER}.apk\`

## 安装与登录
1. 安装 APK（允许未知来源）。
2. 首次：同意免责声明 → 授权通知/位置等 → 学号+教务密码（可先进入再同步课表）。

## 主要功能
| 模块 | 说明 |
| --- | --- |
| 首页 / 服务 | 快捷入口、天气、下一节课、服务目录 |
| 学业 | 课表、成绩、考试、考证提醒 |
| 生活 | 广场、任务、二手、食堂、小店 |
| 消息 / 私信 | 订单与互动通知、IM |
| Campus Petdex | 宠物养成；冒险包/游戏馆可选下载 |
| 设置 | 主题、提醒、角色申请、检查更新 |

## H5
同目录 \`h5/\`，用本地静态服务器打开，或部署到托管。已注入 \`window.__SC_SHELL__='user'\`。

## 小程序
见 \`miniprogram/README.md\`（当前未单独出工程，规划另立项）。
`,
  admin: `# 阳光校园 · 管理端说明书

版本 **${VER}** · APK：\`SunshineCampus-Admin-${VER}.apk\`

## 登录
手机号验证码或手机号+App 密码。需管理员 / 站长权限。

## 功能
- **审核**：档口、骑手申请；成员停用/恢复
- **财务**：提现、费率（按权限）
- **内容**：下架、删评、举报
- **站长**：合伙人审核、成员治理

## H5 / 小程序
见本端 \`h5/\`、\`miniprogram/README.md\`。
`,
  rider: `# 阳光校园 · 骑手端说明书

版本 **${VER}** · APK：\`SunshineCampus-Rider-${VER}.apk\`

## 登录
手机号；须已通过骑手审核。

## 功能
工作台接单 / 配送状态 / 钱包；请开启通知与位置。

## H5 / 小程序
见本端 \`h5/\`、\`miniprogram/README.md\`。
`,
  shop: `# 阳光校园 · 商家端说明书

版本 **${VER}** · APK：\`SunshineCampus-Shop-${VER}.apk\`

## 登录
手机号；须已通过商家审核。

## 功能
商品、订单、店铺、钱包；上架图使用相机/相册。

## H5 / 小程序
见本端 \`h5/\`、\`miniprogram/README.md\`。
`,
  stall: `# 阳光校园 · 档口端说明书

版本 **${VER}** · APK：\`SunshineCampus-Stall-${VER}.apk\`

## 登录
手机号；须已通过档口主审核。

## 功能
接单、菜品、营业时段、公告、评价。

## H5 / 小程序
见本端 \`h5/\`、\`miniprogram/README.md\`。
`,
}

const ARCH = `# 阳光校园 · 架构说明

## 总览
- **前端**：Vite + React 19 + React Router（H5 用 BrowserRouter，原生壳用 HashRouter）
- **原生壳**：Capacitor 7 · Android productFlavors 五端（user/admin/rider/shop/stall）
- **后端**：腾讯云 CloudBase（认证、云数据库 RLS、云函数 / 网关）
- **热更**：COS OTA + Capgo（界面层）；整包 APK 走 \`update.json\`
- **可选包**：\`pet-adventure\`、\`lyg-games\` 独立 CDN，手动下载

## 五端隔离
| 壳 | applicationId | 默认首页 |
| --- | --- | --- |
| user | com.sunshinecampus.app | / |
| admin | com.sunshinecampus.admin | /admin/roles |
| rider | com.sunshinecampus.rider | /work/rider |
| shop | com.sunshinecampus.shop | /work/shop |
| stall | com.sunshinecampus.stall | /work/stall |

Web 层通过 \`window.__SC_SHELL__\` / \`VITE_APP_SHELL\` / 原生包名识别；\`shell-guard\` 限制路由前缀。

## 启动顺序
1. \`#boot-splash\` 启动动画  
2. **首次免责声明 + 权限获取**（\`FirstRunHost\`）  
3. 学生端 \`CampusGate\` / 工作端手机号登录  
4. 业务页 +（学生）提醒宿主  

## 关键目录（源码仓）
- \`src/lib/app-shell.ts\` 壳识别  
- \`src/lib/shell-guard.ts\` 路由白名单  
- \`src/lib/first-run.ts\` / \`FirstRunHost\` 首次协议与权限  
- \`src/services/petdex/*\` 宠物与冒险包  
- \`src/services/games/*\` 港城游戏馆  
- \`docs/\` 历史说明书与发布说明  
`

const NOTES = `# 注意事项（运维 / 交付）

1. **版本对齐**：五端 APK 建议同版本号（当前交付 ${VER}）。  
2. **安全域名**：App WebView origin 为 \`https://localhost\`，CDN/OTA/冒险包/游戏包需在 CloudBase 安全域名放行。  
3. **pet_reward 白名单**：UGC→宠物成长依赖服务端开通，否则客户端领取会失败。  
4. **CORS**：本地 \`127.0.0.1\` 预览拉 CDN 会失败；真机壳或同源托管正常。  
5. **小程序**：尚未单独工程，勿将 H5 直接当小程序上架。  
6. **签名**：Release 使用 \`android/keystore/sunshine-release.jks\`；丢失无法覆盖安装。  
7. **热更**：只改 Web 可 OTA；改原生权限/插件需重打 APK。  
8. **首次引导**：升级后若需强制重看协议，清除 \`sc.firstRun.legal.v1:*\` / \`sc.firstRun.perms.v1:*\`。  
`

const MP_README = `# 微信小程序版（状态说明）

当前 **未交付独立微信小程序工程**（见源码 \`docs/petdex/LANDING.md\`：另立项）。

本目录占位用途：
- 说明各端小程序规划与 App/H5 能力映射
- 后续可用 uni-app / 原生小程序重做，复用 CloudBase 与业务 API

## 规划（非承诺排期）
| 能力 | 小程序可行性 |
| --- | --- |
| 登录 / 课表 | 需适配；教务验证码流程要单独设计 |
| 二手 / 任务 / 食堂 | 可做，需类目与支付资质 |
| IM / 广场 | 依赖腾讯云 IM 与内容安全 |
| 宠物对战 Canvas | 性能与包体需评估 |
| 原生通知 / 专注锁屏 | 小程序能力弱于 App |

请优先分发 **APK** 与 **H5**；小程序待主体、备案与工程就绪后再补。
`

const ROOT_README = `# 阳光校园 · 交付包（新建文件夹 6）

版本：**${VER}**  
生成时间：${new Date().toISOString()}

## 目录结构
\`\`\`
新建文件夹 (6)/
  README.md                 ← 本文件
  架构说明.md
  注意事项.md
  隐私政策与用户协议.md
  ports/
    user|admin|rider|shop|stall/
      免责声明.md
      说明书.md
      apk/   *.apk
      h5/    可静态部署的网页（已注入壳）
      miniprogram/ README.md
\`\`\`

## 怎么用
- **装 App**：进入对应 \`ports/<端>/apk/\` 安装。  
- **开 H5**：\`npx serve ports/user/h5\`（或任意静态服务器）；五端已分别注入 \`__SC_SHELL__\`。  
- **小程序**：见各端 \`miniprogram/README.md\`。  

源码仓：\`Desktop\\xm-main\` · 重新打包：\`node tools/pack-delivery-folder6.mjs\`
`

function main() {
  console.log('[pack] out =', OUT)
  ensureDir(OUT)
  ensureDir(join(OUT, 'ports'))

  writeFileSync(join(OUT, 'README.md'), ROOT_README, 'utf8')
  writeFileSync(join(OUT, '架构说明.md'), ARCH, 'utf8')
  writeFileSync(join(OUT, '注意事项.md'), NOTES, 'utf8')

  const legalSrc = join(ROOT, 'docs', 'legal', '隐私政策与用户协议.md')
  if (existsSync(legalSrc)) copyFileSync(legalSrc, join(OUT, '隐私政策与用户协议.md'))

  // build H5 once
  console.log('[pack] building H5…')
  const build = spawnSync('npm', ['run', 'build:h5'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (build.status !== 0) {
    console.error('[pack] H5 build failed')
    process.exit(build.status || 1)
  }
  const dist = join(ROOT, 'dist')
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('[pack] dist/index.html missing')
    process.exit(1)
  }
  const indexRaw = readFileSync(join(dist, 'index.html'), 'utf8')

  for (const s of SHELLS) {
    const base = join(OUT, 'ports', s.id)
    ensureDir(join(base, 'apk'))
    ensureDir(join(base, 'h5'))
    ensureDir(join(base, 'miniprogram'))

    writeFileSync(join(base, '免责声明.md'), DISCLAIMER[s.id], 'utf8')
    writeFileSync(join(base, '说明书.md'), MANUAL[s.id], 'utf8')
    writeFileSync(join(base, 'miniprogram', 'README.md'), MP_README, 'utf8')

    const apkFrom = join(APK_SRC, s.apk)
    const apkAlt = join(ROOT, '.ota-out', 'apk-5duan-1219', 'downloads', s.apk)
    const apkSrc = existsSync(apkFrom) ? apkFrom : apkAlt
    if (existsSync(apkSrc)) {
      copyFileSync(apkSrc, join(base, 'apk', s.apk))
      console.log('[pack] apk', s.id, '←', apkSrc)
    } else {
      writeFileSync(
        join(base, 'apk', 'MISSING.txt'),
        `未找到 ${s.apk}\n请先运行 tools\\release-5duan.bat 或从 Desktop\\5duan 拷贝。\n`,
        'utf8',
      )
      console.warn('[pack] missing apk', s.apk)
    }

    copyTree(dist, join(base, 'h5'))
    writeFileSync(join(base, 'h5', 'index.html'), injectShell(indexRaw, s.id), 'utf8')
    writeFileSync(
      join(base, 'h5', 'SHELL.txt'),
      `shell=${s.id}\nhome=${s.home}\nlabel=${s.label}\n`,
      'utf8',
    )
  }

  console.log('[pack] done →', OUT)
}

main()
