export const MAP_ICONS = {
  all: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  food: 'M5 3v7m3-7v7m3-7v7M5 7h6m-3 3v11M19 3c-4 2-4 8 0 8V3zm0 8v10',
  fun: 'M7 7h10c3 0 5 9 3 10-2 2-4-2-5-2H9c-1 0-3 4-5 2C2 16 4 7 7 7z M8 10v5m-2.5-2.5h5 M16 11h.01 M18 14h.01',
  checkin: 'M5 6h3l1-2h6l1 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  study: 'm2 8 10-5 10 5-10 5L2 8zm4 2v7c4 3 8 3 12 0v-7m4-2v8',
  life: 'M5 7h14l1 14H4L5 7zm3 0V5a4 4 0 0 1 8 0v2',
  book: 'M12 5C8 2 4 3 2 4v15c3-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-3-2-7-1-10 1V5z',
  location: 'M12 2v3m0 14v3M2 12h3m14 0h3M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  plus: 'M12 4v16M4 12h16',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zm-2 5 6 6',
  expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  arrow: 'm3 10 18-7-7 18-3-8-8-3z',
  close: 'm6 6 12 12M18 6 6 18',
} as const
export type MapIconName = keyof typeof MAP_ICONS
export function MapIcon({ name, className }: { name: MapIconName; className?: string }) {
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={MAP_ICONS[name]} /></svg>
}
