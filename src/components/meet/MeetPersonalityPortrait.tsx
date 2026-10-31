import { MEET_PERSONALITIES, type MeetPersonality } from '../../lib/meet-personality'
import styles from './meet-personality.module.css'

export function MeetPersonalityPortrait({ type, size = 'medium' }: { type: MeetPersonality; size?: 'small' | 'medium' | 'large' }) {
  const index = MEET_PERSONALITIES.findIndex(item => item.code === type)
  const col = index % 4, row = Math.floor(index / 4)
  return <span className={`${styles.portrait} ${styles[size]}`} role="img" aria-label={`${type} ${MEET_PERSONALITIES[index]?.name || '阿狐人格'}`} style={{ backgroundPosition: `${col * 100 / 3}% ${row * 100 / 3}%` }} />
}
