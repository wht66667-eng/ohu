import { HomeServiceIcon } from '../HomeServiceIcon'

export function OhuServiceArtwork({ id, fallback }: { id: string; fallback: string }) {
  return <HomeServiceIcon title={id==='map'?'目标墙':fallback} decorated={false} size={46} />
}
export function OhuHeadingArtwork({ name }: { name: 'schedule' | 'tasks' | 'services' | 'news' | 'help' }) {
  const titles={schedule:'课表查询',tasks:'我的待办',services:'生活互助',news:'校园信息站',help:'校园广场'}
  return <HomeServiceIcon title={titles[name]} decorated={false} size={28} />
}
