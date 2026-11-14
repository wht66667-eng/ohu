/**
 * 站内 /api/* 网关基址（AI 入口 /api/agnes、访客聊天 /api/chat 均挂在云函数上；
 * 楼栋申请 /api/apply 已无前端调用方，路由仅为兼容保留）。
 *
 * 线上函数路由只存在于 CloudBase HTTPSERVICE 网关默认域：
 *   https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com
 * 静态托管默认域（*.tcloudbaseapp.com）是系统内部域，不允许手工绑定云函数路由，
 * 因此页面托管在该域时若同源请求 /api/* 会落到静态桶 → NoSuchKey 404。
 *
 * 网关（tcbgw）会自动应答 OPTIONS 预检并按安全域名注入 CORS 头，跨域调用可用，
 * 故这里按运行环境返回请求前缀：
 *  - 本地 dev（vite）：保持相对路径，由 server.proxy 反代到网关；
 *  - 页面本身跑在网关域：保持相对路径（同源直接命中函数路由）；
 *  - 其余任意托管域（含 *.tcloudbaseapp.com）：改用网关域绝对地址。
 *
 * 【套壳 App 走的是最后一条分支，这是套壳最大的部署风险点】
 *   Capacitor 下 origin 是 `https://localhost`（Android，androidScheme=https）
 *   或 `capacitor://localhost`（iOS），永远不等于 GATEWAY_ORIGIN，
 *   因此请求会跨域打到网关域，依赖网关按「Web 安全域名」注入 CORS 头。
 *   若该 WebView 域没进白名单，请求会被拦（表现为 fetch 失败 / CORS 报错），
 *   所以每次换 origin（改 scheme、改 hostname）都要同步更新环境安全域名。
 */
const GATEWAY_ORIGIN = 'https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com'

function resolveApiBase(): string {
  if (typeof window === 'undefined') return GATEWAY_ORIGIN
  if (import.meta.env.DEV) return ''
  if (window.location.origin === GATEWAY_ORIGIN) return ''
  return GATEWAY_ORIGIN
}

export const API_BASE = resolveApiBase()
