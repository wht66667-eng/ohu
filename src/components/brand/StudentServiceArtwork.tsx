import { HomeServiceIcon } from '../HomeServiceIcon'
import { FoxSheetPose } from '../fox/FoxSheetPose'
import type { FoxPoseId } from '../../lib/fox-sheet'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

const homePoses: Record<string, FoxPoseId> = {
  schedule: 'reading', library: 'studying', bus: 'walking', 'campus-card': 'phone',
  'nearby-food': 'tea', services: 'waving', grades: 'cheering', english: 'reading',
  tasks: 'walking', market: 'phone', sports: 'yay', focus: 'studying', todo: 'writing',
  exams: 'studying', zhongce: 'cheering', messages: 'phone', map: 'map',
}

/** Transparent vector icons replace screenshot crops; controls and routes stay unchanged. */
export function StudentServiceArtwork({ id, fallback, home = false, size = 48 }: { id: string; fallback: string; home?: boolean; size?: number }) {
  const variant = useUiVariant()
  if (home && !isFoxFreeVariant(variant)) return <span style={{ display: 'block', width: size, height: size }}><FoxSheetPose pose={homePoses[id] || 'waving'} /></span>
  if(id==='ai' && !isFoxFreeVariant(variant)) return <FoxSheetPose pose="waving" />
  if(id==='ai') return <HomeServiceIcon title="AI问答" decorated={false} size={size} />
  return <HomeServiceIcon title={id==='map'?'目标墙':fallback} decorated={false} size={size} />
}
