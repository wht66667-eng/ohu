import type { ReactNode } from 'react'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
const shapes: Record<string, ReactNode> = {
 book: <path d="M12 5v15M3 4.5c3-1 6-.5 9 1 3-1.5 6-2 9-1V19c-3-1-6-.5-9 1-3-1.5-6-2-9-1Z" />,
 cal: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M7 15h3m4 0h3m-10 3h3"/></>,
 task: <><rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V2h6v2m-6 9 2 2 4-4"/></>,
 sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
 bag: <path d="M5 8h14l2 13H3Zm3 0V6a4 4 0 0 1 8 0v2"/>,
 box: <path d="m3 7 9-4 9 4v11l-9 4-9-4Zm0 0 9 4 9-4m-9 4v11M7 5l10 4v4"/>,
 shop: <path d="M4 9v12h16V9M3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 21v-6h6v6"/>,
 food: <path d="M4 3v6m3-6v6m3-6v6M4 7h6M7 9v12M19 21V3c-4 2-5 7-1 9h1"/>,
 heart: <path d="M12 21 3.5 12A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 8.5 7Z"/>,
 chat: <><path d="M21 12a9 9 0 0 1-9 9H3l2-5A9 9 0 1 1 21 12Z"/><path d="M8 10h8m-8 4h5"/></>,
 flash: <path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>,
 paw: <><path d="M7 15c3-5 7-5 10 0 5 7-1 8-5 5-4 3-10 2-5-5Z"/><circle cx="5" cy="9" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="16" cy="5" r="2"/><circle cx="21" cy="10" r="2"/></>,
 bus: <><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 12h14M8 20v2m8-2v2M8 16h1m6 0h1M9 6h6"/></>,
 partner: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m2 5a5 5 0 0 1 2 4v2"/></>,
 moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>,
 plus: <path d="M12 4v16M4 12h16"/>,
 link: <><path d="M10 13.5 14 9.5M8.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M15.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/></>,
 bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 20a2 2 0 0 0 4 0M12 2v2"/></>,
 shield: <><path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5Z"/><path d="m8 12 3 3 5-6"/></>,
 update: <><path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6"/><path d="M12 8v8m-3-5 3-3 3 3"/></>,
 flag: <path d="M5 22V3c5-3 9 3 14 0v10c-5 3-9-3-14 0"/>,
 wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5l14-3v3m4 6h-6v5h6M16 13.5h1"/></>,
 key: <><circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9m-3-3 3-3m-6 0 3-3"/></>,
 logout: <><path d="M9 4H4v16h5m-1-8h13m-4-4 4 4-4 4"/></>,
 grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
}
shapes.store=shapes.shop
/** 同一线宽的校园服务图标，已有文字时不重复朗读。 */
export function CampusIcon({name,size=24}:{name:string;size?:number}) {
 const foxfree = isFoxFreeVariant(useUiVariant())
 if (name === 'paw') {
   /* 无狐皮肤：paw 槽位（校园活动等）换成通用星形线图标，不出现狐狸图。 */
   if (foxfree) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l2.4 5.4L20 9.6l-4.2 3.8 1.2 5.9L12 16.2 7 19.3l1.2-5.9L4 9.6l5.6-1.2Z"/></svg>
   return <img src={`${import.meta.env.BASE_URL}pixel-fox/cheer.png`} width={size} height={size} alt="" aria-hidden="true" />
 }
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name] || shapes.grid}</svg>
}
export function CampusWeatherIcon({code}:{code:number}) {
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
 {code > 0 ? <path d="M6 16a4 4 0 1 1 1-7.8A6 6 0 0 1 19 8a4 4 0 1 1 0 8Z"/> : shapes.sun}
 {(code>=51 && code<71)||(code>=80 && code<85) ? <path d="m8 19-1 2m6-2-1 2m6-2-1 2"/> : null}
 {(code>=71 && code<80)||(code>=85 && code<90) ? <path d="M9 19v3m-1.5-1.5h3m6-1.5v3m-1.5-1.5h3"/> : null}
 {code>=95 ? <path d="m13 17-2 3h3l-1 3"/> : null}
 </svg>
}
