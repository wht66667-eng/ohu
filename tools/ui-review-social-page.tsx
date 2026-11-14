/** NON-PRODUCTION. 社工端门（SocialGate）排版样例（TASK-A6）：真实组件 + 合成数据，RPC 由 ui-review-fixtures 合成；无任何真实登录、远程查询或通知。 */
import { useEffect, useState } from 'react'
import { SocialGate } from '../src/components/SocialGate'
import { SimpleHomePage } from '../src/pages/SimpleHomePage'
import { ServicesPage } from '../src/pages/ServicesPage'
import { StudyHubPage } from '../src/pages/study/StudyHubPage'
import { selectPreviewIdentity, setSocialRpcHandler, setSocialShareRows } from './ui-review-fixtures'

export const SOCIAL_SCENARIOS = [
  { value: 'login', label: '登录页（未登录）' },
  { value: 'error', label: '错误态（42883 未部署）' },
  { value: 'bind', label: '绑码页（已登录未绑定）' },
  { value: 'workspace', label: '已绑定 · 首页（教务入口隐藏）' },
  { value: 'services', label: '已绑定 · 服务页（教务服务隐藏）' },
  { value: 'studyhub', label: '已绑定 · 学习中心（同步卡隐藏）' },
] as const
export type SocialScenario = typeof SOCIAL_SCENARIOS[number]['value']

const STUDENT_A = 'stu_00112233445566778899aabbccdd'
const STUDENT_B = 'stu_99aabbccddeeff00112233445566778899'

const SPACES = [
  { id: 1, partner_uid: STUDENT_A, side: 'social', relation: 'lover', relation_label: '', status: 'active', anniversary_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 2, partner_uid: STUDENT_B, side: 'social', relation: 'custom', relation_label: '饭搭子', status: 'active', anniversary_at: '2026-11-01T02:00:00Z', updated_at: '2026-11-10T02:00:00Z' },
]

const SNAPSHOT_A = [
  { week: 12, day: 1, sections: [1, 2], name: '高等数学 · 本地样例', room: '样例楼 A204', teacher: '' },
  { week: 12, day: 1, sections: [3, 4], name: '大学英语 · 本地样例', room: '样例楼 B301', teacher: '' },
  { week: 12, day: 3, sections: [5, 6], name: '数据结构与算法 · 本地样例', room: '样例实验楼 C405', teacher: '' },
  { week: 12, day: 5, sections: [3, 4], name: '计算机实验 · 本地样例', room: '样例实验楼 D102', teacher: '' },
]
const SNAPSHOT_B = [
  { week: 12, day: 2, sections: [3, 4], name: '大学物理 · 本地样例', room: '样例楼 E201', teacher: '' },
  { week: 12, day: 4, sections: [1, 2], name: '有机化学 · 本地样例', room: '样例楼 F105', teacher: '' },
  { week: 12, day: 6, sections: [7, 8], name: '文献检索 · 本地样例', room: '样例楼 G303', teacher: '' },
]

const SHARE_ROWS = [
  { id: 1, student_uid: STUDENT_A, social_uid: 'local:ui-review-a', fields: { time: true, name: true, room: true }, revoked: false, updated_at: '2026-11-14T01:00:00Z' },
  { id: 2, student_uid: STUDENT_B, social_uid: 'local:ui-review-a', fields: { time: true, name: false, room: false }, revoked: false, updated_at: '2026-11-13T01:00:00Z' },
]

/** RPC 合成返回：在渲染期同步注入（SocialGate 首个 status 调用发生在子树挂载 effect 里，晚于此）。 */
function applyScenarioRpc(scenario: SocialScenario) {
  if (scenario === 'login') {
    setSocialShareRows([])
    setSocialRpcHandler(null)
    return
  }
  if (scenario === 'error') {
    setSocialShareRows([])
    setSocialRpcHandler((name) => name === 'social_invite_status'
      ? { data: null, error: { code: '42883', message: 'Could not find the function public.social_invite_status without parameters in the schema cache' } }
      : { data: null, error: { message: 'NON-PRODUCTION fixture: not available' } })
    return
  }
  if (scenario === 'bind') {
    setSocialShareRows([])
    setSocialRpcHandler((name) => name === 'social_invite_status'
      ? { data: { role: 'social', bound: false, bound_code: '', invites: [], spaces: [] } }
      : { data: null, error: { message: '邀请码不存在，请核对后重试' } })
    return
  }
  setSocialShareRows(SHARE_ROWS)
  setSocialRpcHandler((name, params) => {
    if (name === 'social_invite_status') {
      return { data: { role: 'social', bound: true, bound_code: 'ABCD-EF23', invites: [{ code: 'ABCD-EF23', used_count: 1, max_uses: 1, relation: 'lover', relation_label: '' }], spaces: SPACES } }
    }
    if (name === 'schedule_share_read') {
      const student = String(params?.p_student_uid || '')
      if (student === STUDENT_A) return { data: { ok: true, student_uid: STUDENT_A, fields: { time: true, name: true, room: true }, updated_at: '2026-11-14T01:00:00Z', source: 'timetable_snapshots', snapshot: SNAPSHOT_A } }
      if (student === STUDENT_B) return { data: { ok: true, student_uid: STUDENT_B, fields: { time: true, name: false, room: false }, updated_at: '2026-11-13T01:00:00Z', source: 'timetable_snapshots', snapshot: SNAPSHOT_B } }
      return { data: { ok: false, reason: 'NOT_SHARED' } }
    }
    if (name === 'social_invite_redeem') return { data: null, error: { message: '本地样例不执行兑换' } }
    return { data: null, error: { message: 'NON-PRODUCTION fixture: not available' } }
  })
}

function applyScenarioIdentity(scenario: SocialScenario) {
  selectPreviewIdentity(scenario === 'login' ? '' : 'local:ui-review-a')
  // TASK-A6：社工端复用学生端壳——首页/服务页/学习中心按 track 条件渲染
  try {
    localStorage.setItem('ohu.entry-track.v1', 'social')
    window.dispatchEvent(new Event('ohhu-entry-track-change'))
  } catch { /* ignore */ }
}

function SocialChildPage({ scenario }: { scenario: SocialScenario }) {
  if (scenario === 'services') return <ServicesPage />
  if (scenario === 'studyhub') return <StudyHubPage />
  return <SimpleHomePage />
}

export function SocialGatePreview() {
  const [scenario, setScenario] = useState<SocialScenario>('workspace')
  // 渲染期同步注入 RPC 合成返回（幂等 setter）；身份切换放到 effect，避免渲染期触发外部 store 通知。
  applyScenarioRpc(scenario)
  useEffect(() => {
    applyScenarioIdentity(scenario)
    // 注意：场景切换的 effect 清理不能清掉 handler（cleanup 先于下一次渲染期注入之后的门状态检查执行）；
    // 卸载清理交给下方独立 effect。
  }, [scenario])
  useEffect(() => {
    return () => setSocialRpcHandler(null)
  }, [])
  return <div className="ui-review-social">
    <label className="ui-review-scenario">社工端门样例
      <select aria-label="社工端门样例" value={scenario} onChange={(event) => setScenario(event.target.value as SocialScenario)}>
        {SOCIAL_SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
    <div data-social-preview-phone>
      {/* key=scenario：场景切换时整门重挂载，绑码检查随合成返回重新执行 */}
      <SocialGate key={scenario}>
        {scenario === 'login' || scenario === 'error' || scenario === 'bind'
          ? <div style={{ padding: '48px 20px', textAlign: 'center', color: '#5c6f64' }}>（此处为社工端 App 内容 · 本地样例）</div>
          : <SocialChildPage scenario={scenario} />}
      </SocialGate>
    </div>
  </div>
}
