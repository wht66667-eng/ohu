import type { ReactNode } from 'react'
import { useUiVariant } from '../lib/ui-variant'
import { CampusIcon } from './CampusIcon'
import styles from './HomeServiceIcon.module.css'

const artwork: Record<string, ReactNode> = {
  '校园卡': <g stroke="#174b37" strokeWidth="2.6" strokeLinejoin="round"><rect x="8" y="15" width="48" height="35" rx="7" fill="#fff8eb"/><path d="M9 25h46" strokeWidth="7"/><rect x="17" y="33" width="12" height="8" rx="2" fill="#ffb466" stroke="none"/><path d="M36 39h10" strokeLinecap="round"/></g>,
  '寝室电费': <g stroke="#174b37" strokeWidth="2.6" strokeLinejoin="round"><rect x="12" y="10" width="40" height="46" rx="9" fill="#fff8eb"/><path d="M34 20 24 36h8l-4 14 14-18h-9l5-12Z" fill="#ffb466"/></g>,
  '校园班车': <g stroke="#174b37" strokeWidth="2.6" strokeLinejoin="round"><rect x="13" y="7" width="38" height="47" rx="9" fill="#ffc46c"/><rect x="19" y="15" width="26" height="19" rx="4" fill="#fff8eb"/><path d="M18 55v3m28-3v3M24 11h16" strokeLinecap="round"/><circle cx="23" cy="43" r="3" fill="#174b37"/><circle cx="41" cy="43" r="3" fill="#174b37"/></g>,
  '图书馆座位': <g stroke="#174b37" strokeWidth="2.6" strokeLinejoin="round"><path d="M19 29V16c0-12 26-12 26 0v13" fill="#9cc998"/><path d="M15 27c-7-4-9 7-6 15l4 7h38l4-7c3-8 1-19-6-15l-4 9H19Z" fill="#5b9b69"/><path d="M18 49v8m28-8v8M19 36h26" strokeLinecap="round"/></g>,
  '学习计划': <g stroke="#174b37" strokeWidth="2.6" fill="none" strokeLinecap="round"><circle cx="30" cy="33" r="22" fill="#d9ebcd"/><circle cx="30" cy="33" r="13"/><path d="m30 33 24-24m-1-3 3 8-8-3" strokeWidth="4"/></g>,
  '目标墙': <g stroke="#174b37" strokeWidth="2.6" strokeLinejoin="round"><path d="M32 57S12 37 12 23a20 20 0 1 1 40 0c0 14-20 34-20 34Z" fill="#8fc780"/><circle cx="32" cy="23" r="10" fill="#fff8eb"/></g>,
  '课表查询': (
    <>
      <rect x="10" y="13" width="44" height="43" rx="9" fill="var(--art-blue)" />
      <path d="M19 13h26a9 9 0 0 1 9 9v7H10v-7a9 9 0 0 1 9-9Z" fill="var(--art-blue-light)" />
      <rect x="19" y="7" width="5" height="15" rx="2.5" fill="var(--art-blue-deep)" />
      <rect x="40" y="7" width="5" height="15" rx="2.5" fill="var(--art-blue-deep)" />
      <g fill="var(--art-paper)">
        <rect x="19" y="35" width="7" height="6" rx="2" />
        <rect x="29" y="35" width="7" height="6" rx="2" />
        <rect x="39" y="35" width="7" height="6" rx="2" />
        <rect x="19" y="45" width="7" height="6" rx="2" />
        <rect x="29" y="45" width="7" height="6" rx="2" />
      </g>
    </>
  ),
  '成绩查询': (
    <>
      <path d="M18 8h22l12 12v30a7 7 0 0 1-7 7H18a7 7 0 0 1-7-7V15a7 7 0 0 1 7-7Z" fill="var(--art-green)" />
      <path d="M40 8v9a3 3 0 0 0 3 3h9Z" fill="var(--art-green-light)" />
      <rect x="20" y="35" width="6" height="13" rx="2" fill="var(--art-paper)" />
      <rect x="29" y="29" width="6" height="19" rx="2" fill="var(--art-paper)" />
      <rect x="38" y="24" width="6" height="24" rx="2" fill="var(--art-paper)" />
      <path d="m47 43 4-4 4 4 5 1-1 5 1 5-5 1-4 4-4-4-5-1 1-5-1-5Z" fill="var(--art-yellow)" />
      <path d="m48 49 2 2 4-4" fill="none" stroke="var(--art-amber-deep)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  '综测加分': (
    <>
      <path d="m17 9 11-2 4 20-10 7Z" fill="var(--art-amber)" />
      <path d="m47 9-11-2-4 20 10 7Z" fill="var(--art-amber-deep)" />
      <circle cx="32" cy="37" r="22" fill="var(--art-yellow)" />
      <circle cx="32" cy="37" r="17" fill="var(--art-amber)" />
      <path d="m32 25 3.6 7.3 8.1 1.2-5.9 5.7 1.4 8.1-7.2-3.8-7.2 3.8 1.4-8.1-5.9-5.7 8.1-1.2Z" fill="var(--art-paper)" />
    </>
  ),
  '考试安排': (
    <>
      <rect x="12" y="11" width="39" height="46" rx="8" fill="var(--art-violet)" />
      <rect x="23" y="7" width="17" height="10" rx="4" fill="var(--art-violet-light)" />
      <path d="M22 26h18M22 35h12M22 44h8" fill="none" stroke="var(--art-paper)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="46" cy="45" r="14" fill="var(--art-violet-deep)" />
      <circle cx="46" cy="45" r="10.5" fill="var(--art-paper)" />
      <path d="M46 39v6l4 3" fill="none" stroke="var(--art-violet-deep)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  '英语学习': (
    <>
      <path d="M8 15c9-3 16-2 24 3 8-5 15-6 24-3v34c-9-3-16-2-24 3-8-5-15-6-24-3Z" fill="var(--art-cyan)" />
      <path d="M8 15c9-3 16-2 24 3v34c-8-5-15-6-24-3Z" fill="var(--art-cyan-light)" />
      <path d="M32 18v34" fill="none" stroke="var(--art-cyan-deep)" strokeWidth="3" />
      <path d="m14 35 5-13 5 13m-8-4h6M40 25h9m-9 7h9m-9 7h6" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m44 46 3-1v13l-3-2-3 2V47Z" fill="var(--art-yellow)" />
    </>
  ),
  '番茄专注': (
    <>
      <path d="M32 17C9 6 2 32 13 48c7 11 31 11 38 0C62 32 55 6 32 17Z" fill="var(--art-coral)" />
      <path d="M15 24c3-5 6-6 10-6" fill="none" stroke="var(--art-coral-light)" strokeWidth="4" strokeLinecap="round" />
      <path d="m32 18-13-7 9 1 4-8 4 8 9-1-13 7Z" fill="var(--art-green)" />
      <circle cx="33" cy="36" r="13" fill="var(--art-paper)" />
      <path d="M33 28v8l5 3" fill="none" stroke="var(--art-coral)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  '我的待办': (
    <>
      <path d="M22 17v-3a10 10 0 0 1 20 0v3" fill="none" stroke="var(--art-amber-deep)" strokeWidth="5" strokeLinecap="round" />
      <rect x="10" y="15" width="44" height="42" rx="8" fill="var(--art-amber)" />
      <path d="M18 15h28a8 8 0 0 1 8 8v7H10v-7a8 8 0 0 1 8-8Z" fill="var(--art-yellow)" />
      <path d="m20 38 3 3 5-6m-8 13 3 3 5-6" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 38h10m-10 10h10" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  '校园广场': (
    <>
      <path d="M31 20h17a10 10 0 0 1 10 10v13a10 10 0 0 1-10 10h-3l-9 7v-7h-5a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10Z" fill="var(--art-pink-light)" />
      <path d="M17 8h22a11 11 0 0 1 11 11v17a11 11 0 0 1-11 11H25l-12 8v-9a11 11 0 0 1-7-10V19A11 11 0 0 1 17 8Z" fill="var(--art-pink)" />
      <g fill="var(--art-paper)">
        <circle cx="18" cy="28" r="3" />
        <circle cx="28" cy="28" r="3" />
        <circle cx="38" cy="28" r="3" />
      </g>
    </>
  ),
  '查物流': (
    <>
      <path d="m8 19 24-11 24 11-24 12Z" fill="var(--art-yellow)" />
      <path d="M8 19v29l24 12V31Z" fill="var(--art-amber)" />
      <path d="M32 31v29l24-12V19Z" fill="var(--art-amber-deep)" />
      <path d="m23 12 24 11v13l-8 4V27L15 16Z" fill="var(--art-paper)" />
      <path d="m15 37 10 5m-10 2 6 3" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  '二手交易': (
    <>
      <path d="M22 17v-3a10 10 0 0 1 20 0v3" fill="none" stroke="var(--art-amber-deep)" strokeWidth="5" strokeLinecap="round" />
      <path d="M14 17h36l5 32a7 7 0 0 1-7 8H16a7 7 0 0 1-7-8Z" fill="var(--art-amber)" />
      <path d="M14 17h36l2 12H12Z" fill="var(--art-yellow)" />
      <path d="M21 37h22m-5-5 5 5-5 5M43 48H21m5-5-5 5 5 5" fill="none" stroke="var(--art-paper)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  '生活互助': (
    <>
      <circle cx="32" cy="32" r="25" fill="var(--art-green)" />
      <path d="M15 22a20 20 0 0 1 18-10" fill="none" stroke="var(--art-green-light)" strokeWidth="4" strokeLinecap="round" />
      <path d="m32 47-14-14a9 9 0 0 1 14-11 9 9 0 0 1 14 11Z" fill="var(--art-paper)" />
    </>
  ),
  '校园信息站': (
    <>
      <path d="m21 34 7 19a4 4 0 0 1-7 3l-9-18Z" fill="var(--art-blue-deep)" />
      <rect x="7" y="22" width="22" height="19" rx="5" fill="var(--art-blue)" />
      <path d="m26 22 23-12v43L26 41Z" fill="var(--art-blue-light)" />
      <rect x="46" y="8" width="6" height="47" rx="3" fill="var(--art-blue)" />
      <path d="M13 28h8" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
      <path d="m56 17 4-3m-4 17h5m-5 13 4 3" fill="none" stroke="var(--art-yellow)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  '附近美食': (
    <>
      <path d="M10 31h44c0 14-8 23-22 23S10 45 10 31Z" fill="var(--art-coral)" />
      <ellipse cx="32" cy="31" rx="22" ry="5" fill="var(--art-coral-light)" />
      <ellipse cx="32" cy="30" rx="17" ry="2.5" fill="var(--art-yellow)" />
      <rect x="22" y="52" width="20" height="5" rx="2.5" fill="var(--art-coral)" />
      <path d="M20 22c-6-6 6-8 0-14m12 14c-6-6 6-8 0-14m12 14c-6-6 6-8 0-14" fill="none" stroke="var(--art-amber)" strokeWidth="3" strokeLinecap="round" />
      <path d="M19 39c2 5 5 7 9 8" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  '快捷代取': (
    <>
      <path d="M6 22h12M3 31h12m-9 9h11" fill="none" stroke="var(--art-cyan-light)" strokeWidth="4" strokeLinecap="round" />
      <rect x="21" y="18" width="34" height="34" rx="7" fill="var(--art-cyan)" />
      <path d="M28 18h20a7 7 0 0 1 7 7v5H21v-5a7 7 0 0 1 7-7Z" fill="var(--art-cyan-light)" />
      <rect x="34" y="18" width="8" height="17" rx="2" fill="var(--art-paper)" />
      <circle cx="50" cy="48" r="12" fill="var(--art-yellow)" />
      <path d="m51 40-6 9h5l-1 7 7-10h-5Z" fill="var(--art-amber-deep)" />
    </>
  ),
  '运动中心': (
    <>
      <path d="m12 18 13 5 9 13 19 6a9 9 0 0 1 6 9v3H8a5 5 0 0 1-5-5V36Z" fill="var(--art-coral)" />
      <path d="m12 18 13 5 4 6-13 4-8-7Z" fill="var(--art-coral-light)" />
      <path d="M3 46h14l6 3h36v5H8a5 5 0 0 1-5-5Z" fill="var(--art-paper)" />
      <path d="m30 32-7 4m13 2-7 4" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 55h48" fill="none" stroke="var(--art-coral)" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  '学业中心': (
    <>
      <path d="M11 36c7-2 14-1 21 3 7-4 14-5 21-3v20c-7-2-14-1-21 3-7-4-14-5-21-3Z" fill="var(--art-blue-light)" />
      <path d="M32 39v20" fill="none" stroke="var(--art-blue-deep)" strokeWidth="3" />
      <path d="M17 22v11c8 6 22 6 30 0V22Z" fill="var(--art-blue)" />
      <path d="m3 18 29-13 29 13-29 13Z" fill="var(--art-blue)" />
      <path d="m32 18 22 10v13" fill="none" stroke="var(--art-yellow)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="51" y="39" width="6" height="10" rx="3" fill="var(--art-yellow)" />
      <path d="m17 45 8 2m14 0 8-2" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  '小店街': (
    <>
      <rect x="10" y="25" width="44" height="32" rx="6" fill="var(--art-violet)" />
      <path d="M13 9h38l7 17H6Z" fill="var(--art-violet-light)" />
      <path d="M21 9h8l-2 17H16Zm14 0h8l5 17H37Z" fill="var(--art-violet)" />
      <path d="M6 26h13a6.5 6.5 0 0 1-13 0m13 0h13a6.5 6.5 0 0 1-13 0m13 0h13a6.5 6.5 0 0 1-13 0m13 0h13a6.5 6.5 0 0 1-13 0" fill="var(--art-violet-deep)" />
      <rect x="18" y="37" width="13" height="13" rx="3" fill="var(--art-paper)" />
      <path d="M38 57V40a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v17Z" fill="var(--art-paper)" />
    </>
  ),
  '校园任务': (
    <>
      <rect x="12" y="11" width="40" height="47" rx="8" fill="var(--art-green)" />
      <rect x="23" y="6" width="18" height="11" rx="4" fill="var(--art-green-light)" />
      <path d="m20 29 3 3 5-6m-8 18 3 3 5-6" fill="none" stroke="var(--art-paper)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M35 29h9M35 44h9" fill="none" stroke="var(--art-paper)" strokeWidth="3.5" strokeLinecap="round" />
    </>
  ),
  '失物招领': (
    <>
      <path d="M21 18v-3a11 11 0 0 1 22 0v3" fill="none" stroke="var(--art-amber-deep)" strokeWidth="5" strokeLinecap="round" />
      <rect x="9" y="18" width="45" height="39" rx="7" fill="var(--art-amber)" />
      <path d="M16 18h31a7 7 0 0 1 7 7v9H9v-9a7 7 0 0 1 7-7Z" fill="var(--art-yellow)" />
      <rect x="24" y="31" width="10" height="8" rx="2" fill="var(--art-paper)" />
      <path d="m46 26 13 10-2 17a3 3 0 0 1-3 3H39a3 3 0 0 1-3-3V36Z" fill="var(--art-blue)" />
      <circle cx="46" cy="34" r="2" fill="var(--art-paper)" />
      <path d="M42 42a4 4 0 0 1 8 0c0 3-4 3-4 6" fill="none" stroke="var(--art-paper)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="46" cy="52" r="1.5" fill="var(--art-paper)" />
    </>
  ),
  '校园活动': (
    <>
      <path d="M14 13h36a7 7 0 0 1 7 7v5a7 7 0 0 0 0 14v6a7 7 0 0 1-7 7H14a7 7 0 0 1-7-7v-6a7 7 0 0 0 0-14v-5a7 7 0 0 1 7-7Z" fill="var(--art-pink)" />
      <path d="M14 13h36a7 7 0 0 1 7 7v3H7v-3a7 7 0 0 1 7-7Z" fill="var(--art-pink-light)" />
      <path d="m32 23 3.5 7.1 7.8 1.1-5.7 5.5 1.4 7.8-7-3.7-7 3.7 1.4-7.8-5.7-5.5 7.8-1.1Z" fill="var(--art-paper)" />
    </>
  ),
  '四六级 / 普通话': (
    <>
      <rect x="10" y="8" width="42" height="47" rx="7" fill="var(--art-cyan)" />
      <path d="M19 18h24m-24 7h15" fill="none" stroke="var(--art-paper)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="m19 42 5-12 5 12m-8-4h6" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m42 42-4 18 9-5 8 5-4-18Z" fill="var(--art-coral)" />
      <circle cx="47" cy="41" r="12" fill="var(--art-yellow)" />
      <path d="m42 41 3 3 6-6" fill="none" stroke="var(--art-amber-deep)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  '结伴出行': (
    <>
      <rect x="11" y="8" width="42" height="47" rx="10" fill="var(--art-blue)" />
      <rect x="17" y="17" width="30" height="19" rx="4" fill="var(--art-cyan-light)" />
      <path d="M21 22h8m3-5v19" fill="none" stroke="var(--art-paper)" strokeWidth="3" strokeLinecap="round" />
      <rect x="23" y="11" width="18" height="3" rx="1.5" fill="var(--art-paper)" />
      <circle cx="21" cy="44" r="4" fill="var(--art-yellow)" />
      <circle cx="43" cy="44" r="4" fill="var(--art-yellow)" />
      <rect x="17" y="52" width="8" height="8" rx="3" fill="var(--art-blue-deep)" />
      <rect x="39" y="52" width="8" height="8" rx="3" fill="var(--art-blue-deep)" />
    </>
  ),
  '合伙人招募': (
    <>
      <rect x="11" y="13" width="42" height="44" rx="8" fill="var(--art-green)" />
      <rect x="23" y="9" width="18" height="9" rx="3" fill="var(--art-green-light)" />
      <path d="m24 5 8 10 8-10" fill="none" stroke="var(--art-green)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="31" cy="30" r="6" fill="var(--art-paper)" />
      <path d="M20 47c0-10 22-10 22 0v1H20Z" fill="var(--art-paper)" />
      <circle cx="50" cy="48" r="12" fill="var(--art-yellow)" />
      <path d="M50 42v12m-6-6h12" fill="none" stroke="var(--art-amber-deep)" strokeWidth="3" strokeLinecap="round" />
    </>
  ),

}

/** 校园服务共用的彩色实心插画，名称由旁边的链接文字提供。 */
export function HomeServiceIcon({ title, simple = false, decorated = true, size = 56 }: { title: string; simple?: boolean; decorated?: boolean; size?: number }) {
  const variant = useUiVariant()
  const fox = decorated && (variant === 'fox' || variant === 'cute')
  if (simple || variant === 'minimal' || !fox) {
    const name: Record<string,string> = { '课表查询':'cal', '成绩查询':'book', '考试安排':'cal', '英语学习':'book', '综测加分':'flag', '番茄专注':'sun', '我的待办':'task', '学业中心':'book', '附近美食':'food', '小店街':'shop', '查物流':'box', '快捷代取':'box', '运动中心':'heart', '生活互助':'partner', '二手交易':'bag', '结伴出行':'partner', '合伙人招募':'partner', '校园活动':'cal', '失物招领':'box', '校园任务':'task', '四六级 / 普通话':'book', '校园信息站':'bell', '校园广场':'chat', '目标墙':'flag', '校园卡':'wallet', '校园班车':'bus', '图书馆座位':'book', 'AI问答':'chat', '学习计划':'task' }
    return <CampusIcon name={name[title] || 'grid'} size={Math.round(size * .68)} />
  }
  return (
    <svg className={styles.artwork} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      {fox ? <g aria-hidden="true"><path d="m9 16 3-14 13 13m14 0L52 2l3 14" fill="var(--fox)" /><path d="m12 2 5 5-6 3m41-8-5 5 6 3" fill="var(--green-deep)" /></g> : null}
      <g transform={fox ? 'translate(4 6) scale(.875)' : undefined}>{artwork[title] || (
        <g>
          <rect x="9" y="9" width="20" height="20" rx="6" fill="var(--art-blue)" />
          <rect x="35" y="9" width="20" height="20" rx="6" fill="var(--art-green)" />
          <rect x="9" y="35" width="20" height="20" rx="6" fill="var(--art-pink)" />
          <rect x="35" y="35" width="20" height="20" rx="6" fill="var(--art-amber)" />
        </g>
      )}</g>
    </svg>
  )
}
