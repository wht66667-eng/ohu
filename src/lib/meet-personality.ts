export const MEET_PERSONALITIES = [
  { code: 'ISTJ', name: '稳稳规划家', note: '重视清楚步骤，答应的事认真完成。' },
  { code: 'ISFJ', name: '温柔守护者', note: '愿意照顾伙伴，也留意大家的感受。' },
  { code: 'INFJ', name: '安静理想派', note: '喜欢有意义的交流，习惯先倾听再表达。' },
  { code: 'INTJ', name: '策略观察家', note: '先看全局，再规划一条可行的路线。' },
  { code: 'ISTP', name: '动手探索家', note: '遇到问题先试试，喜欢边做边找答案。' },
  { code: 'ISFP', name: '自在创作者', note: '在意真实体验，也乐于发现日常的小美好。' },
  { code: 'INFP', name: '温柔想象家', note: '重视内心认同，常能看到事情的另一种可能。' },
  { code: 'INTP', name: '好奇研究员', note: '喜欢追问原因，在想法碰撞里找到乐趣。' },
  { code: 'ESTP', name: '活力行动派', note: '喜欢直接体验，想到就愿意迈出第一步。' },
  { code: 'ESFP', name: '快乐气氛组', note: '乐于分享现场的快乐，让活动轻松起来。' },
  { code: 'ENFP', name: '热情灵感家', note: '点子多、好奇心强，喜欢认识新伙伴。' },
  { code: 'ENTP', name: '创意辩友', note: '享受脑洞讨论，也喜欢换个角度看问题。' },
  { code: 'ESTJ', name: '靠谱组织者', note: '目标明确，擅长把大家的想法变成行动。' },
  { code: 'ESFJ', name: '暖心联络员', note: '喜欢大家一起参与，也会主动照顾氛围。' },
  { code: 'ENFJ', name: '同行鼓励者', note: '善于鼓励伙伴，愿意一起把计划推进下去。' },
  { code: 'ENTJ', name: '愿景领航员', note: '喜欢挑战目标，愿意为团队安排清晰方向。' },
] as const

export type MeetPersonality = typeof MEET_PERSONALITIES[number]['code']
export type MeetPersonalityPreference = MeetPersonality | null
export type MeetPersonalityProfile = { type: MeetPersonality | null; preferred: MeetPersonality | null }

const TYPES = new Set<string>(MEET_PERSONALITIES.map(item => item.code))
const KEY_PREFIX = 'ohu.meet.personality.v1:'
export function isMeetPersonality(value: unknown): value is MeetPersonality {
  return typeof value === 'string' && TYPES.has(value)
}
export function meetPersonalityName(value: MeetPersonality | null | undefined): string {
  return MEET_PERSONALITIES.find(item => item.code === value)?.name || '暂不填写'
}
export function readMeetPersonalityProfile(owner: string): MeetPersonalityProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + encodeURIComponent(owner || 'guest')) || 'null') as Record<string, unknown> | null
    return { type: isMeetPersonality(raw?.type) ? raw.type : null, preferred: isMeetPersonality(raw?.preferred) ? raw.preferred : null }
  } catch { return { type: null, preferred: null } }
}
export function saveMeetPersonalityProfile(owner: string, profile: MeetPersonalityProfile): void {
  try {
    localStorage.setItem(KEY_PREFIX + encodeURIComponent(owner || 'guest'), JSON.stringify({
      type: isMeetPersonality(profile.type) ? profile.type : null,
      preferred: isMeetPersonality(profile.preferred) ? profile.preferred : null,
    }))
  } catch { /* The activity form remains usable when local storage is unavailable. */ }
}
