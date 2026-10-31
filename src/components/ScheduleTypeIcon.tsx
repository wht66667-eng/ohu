/**
 * 课表课程类型图标：按课名关键词匹配，emoji 兜底（A3 PNG 到位后可切换）
 */
const KEYWORDS: Array<{ kind: string; match: RegExp }> = [
  { kind: 'experiment', match: /实验|化学|物理|生物|lab/i },
  { kind: 'computer', match: /上机|编程|程序|数据结构|算法|计算机|软件/i },
  { kind: 'language', match: /英语|口语|日语|韩语|俄语|法语|德语|翻译/i },
  { kind: 'pe', match: /体育|篮球|足球|排球|网球|健美|体操|武术/i },
  { kind: 'music', match: /音乐|合唱|钢琴|声乐|器乐/i },
  { kind: 'art', match: /美术|绘画|设计|摄影|书法|雕塑/i },
  { kind: 'lecture', match: /.*/ },
]

const SCHEDULE_TYPE_EMOJI: Record<string, string> = {
  lecture: '📖',
  experiment: '🧪',
  computer: '💻',
  language: '💬',
  pe: '🏀',
  music: '🎵',
  art: '🎨',
  misc: '❓',
}

export function resolveScheduleKind(name: string): string {
  const hit = KEYWORDS.find((k) => k.match.test(name))
  return hit?.kind ?? 'lecture'
}

export function ScheduleTypeIcon({
  name,
  className,
  size = 20,
}: {
  name: string
  className?: string
  size?: number
}) {
  const kind = resolveScheduleKind(name)
  return (
    <span className={className} aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>
      {SCHEDULE_TYPE_EMOJI[kind] ?? '📖'}
    </span>
  )
}
