export type FocusIconName = 'timer' | 'tasks' | 'stats' | 'settings' | 'moon' | 'sun' | 'back' | 'close' | 'play' | 'pause' | 'plus' | 'copy' | 'check' | 'down' | 'sound' | 'mute'

const paths: Record<FocusIconName, React.ReactNode> = {
  timer: <><circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 5V2m0 11V9m6-4 2 2" /></>,
  tasks: <><path d="m3 6 2 2 3-4m-5 9 2 2 3-4m-5 9 2 2 3-4M11 6h10M11 13h10M11 20h10" /></>,
  stats: <><path d="M4 20V11m8 9V4m8 16v-7M2 22h20" /></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
  moon: <path d="M20 15a8.5 8.5 0 0 1-11-11A8.5 8.5 0 1 0 20 15Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  back: <path d="m14 5-7 7 7 7M7 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  play: <path d="m8 4 12 8-12 8Z" />,
  pause: <><path d="M7 5v14M17 5v14" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  sound: <><path d="m11 4-6 5H2v6h3l6 5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  mute: <><path d="m11 4-6 5H2v6h3l6 5Z" /><path d="m16 9 6 6m-6 0 6-6" /></>,
}

export function FocusIcon({ name, size = 20 }: { name: FocusIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
