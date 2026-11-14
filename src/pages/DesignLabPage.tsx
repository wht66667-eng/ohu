import { useState, type ReactElement, type ReactNode } from 'react'
import { Banner as AxBanner } from '@astryxdesign/core/Banner'
import { Badge as AxBadge } from '@astryxdesign/core/Badge'
import { Button as AxButton } from '@astryxdesign/core/Button'
import { Card as AxCard } from '@astryxdesign/core/Card'
import { ClickableCard as AxClickableCard } from '@astryxdesign/core/ClickableCard'
import { EmptyState as AxEmptyState } from '@astryxdesign/core/EmptyState'
import { Grid as AxGrid } from '@astryxdesign/core/Grid'
import { Heading as AxHeading } from '@astryxdesign/core/Heading'
import { HStack as AxHStack } from '@astryxdesign/core/HStack'
import { Text as AxText } from '@astryxdesign/core/Text'
import { TextInput as AxTextInput } from '@astryxdesign/core/TextInput'
import { VStack as AxVStack } from '@astryxdesign/core/VStack'
import { ThemeContext } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'

import { CampusIcon } from '../components/CampusIcon'
import { EmptyState as OhuEmptyState, ErrorState as OhuErrorState } from '../components/ui/StateViews'
import styles from './design-lab.module.css'

/**
 * 设计系统隔离试验页（/design-lab）。
 *
 * 只用于「现有哦狐组件 vs Meta Astryx」并排对照选型，不是生产入口：
 * 底栏不挂、无其他页面链接到本页，Astryx 依赖也只被本文件引用。
 *
 * 隔离手段（详见 docs/product 台账 ASTRYX-LAB-1）：
 * - 不使用 Astryx 的 <Theme> 提供者——它在树根时会把 data-theme / data-astryx-theme
 *   写到 document.documentElement，与哦狐自己的 :root[data-theme='dark'] 暗色机制冲突；
 *   改为自己渲染带 data-astryx-theme 的容器，靠 theme.css 的 @scope 只作用于该子树。
 * - 不导入 @astryxdesign/core/reset.css（全局无 @scope 的 Preflight 式重置）。
 * - 不导入 @astryxdesign/theme-neutral/fonts.css（@import 谷歌字体 Figtree，离线壳不应联网取字）。
 * - 不引用 font-assets/ 字库，不改 src/skins.css 与 src/lib/ui-variant.ts。
 */

/** 底栏五项与常用 tile 沿用 src/pages/home/home-preferences.ts 的默认六项与 TabBar 固定五项。 */
const TILES = [
  { label: '课表', icon: 'cal' },
  { label: '图书馆', icon: 'book' },
  { label: '校园班车', icon: 'bus' },
  { label: '校园卡', icon: 'card' },
  { label: '附近美食', icon: 'food' },
  { label: '更多服务', icon: 'grid' },
] as const

const TABS = ['首页', '服务', '发布', '广场', '我的'] as const

/** Astryx 内置图标注册表仅 29 个系统级字形，校园域图标缺失，故右栏 tile 不配图标。 */
const ASTRYX_ICON_NAMES = 29

function AstryxScope({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme: neutralTheme, mode: 'light' }}>
      {children}
    </ThemeContext.Provider>
  )
}

function OhuNextClassCard() {
  return (
    <div className={styles.classCard}>
      <strong className={styles.classTime}>
        10:00
        <small>11:35</small>
      </strong>
      <span className={styles.className}>高等数学（示例）</span>
      <span className={styles.classStatus}>下一节课</span>
      <span className={styles.classMeta}>教学楼 A-302 · 第 3-4 节（示例）</span>
      <span className={styles.classHint}>还有 25 分钟开始（示例）</span>
    </div>
  )
}

function AstryxNextClassCard() {
  return (
    <AstryxScope>
      <AxCard padding={3}>
        <AxVStack gap={1}>
          <AxHStack gap={2}>
            <AxText size="xl" weight="bold" color="accent">10:00</AxText>
            <AxText size="sm" color="secondary">11:35</AxText>
            <AxBadge variant="warning" label="下一节课" />
          </AxHStack>
          <AxText weight="semibold">高等数学（示例）</AxText>
          <AxText size="sm" color="secondary">教学楼 A-302 · 第 3-4 节（示例）</AxText>
          <AxText size="sm" color="accent">还有 25 分钟开始（示例）</AxText>
        </AxVStack>
      </AxCard>
    </AstryxScope>
  )
}

function OhuTiles() {
  return (
    <nav className={styles.tiles} aria-label="常用功能（示例）">
      {TILES.map((tile) => (
        <span key={tile.label} className={styles.tile}>
          <span className={styles.tileIcon}><CampusIcon name={tile.icon} size={26} /></span>
          <span className={styles.tileLabel}>{tile.label}</span>
        </span>
      ))}
    </nav>
  )
}

function AstryxTiles() {
  return (
    <AstryxScope>
      <AxGrid columns={3} gap={1}>
        {TILES.map((tile) => (
          <AxClickableCard key={tile.label} label={`${tile.label}（示例）`} padding={2}>
            <AxText size="sm" weight="semibold">{tile.label}</AxText>
          </AxClickableCard>
        ))}
      </AxGrid>
    </AstryxScope>
  )
}

function OhuButtons() {
  return (
    <div className={styles.btnRow}>
      <button type="button" className={styles.btnMain}>立即更新</button>
      <button type="button" className={styles.btnGhost}>稍后提醒</button>
      <button type="button" className={styles.btnSoft}>查看课表</button>
      <button type="button" className={styles.btnDanger}>清除密码</button>
      <button type="button" className={styles.btnMain} disabled>已禁用</button>
    </div>
  )
}

function AstryxButtons() {
  return (
    <AstryxScope>
      <AxHStack gap={2} wrap="wrap">
        <AxButton label="立即更新" variant="primary" />
        <AxButton label="稍后提醒" variant="secondary" />
        <AxButton label="查看课表" variant="ghost" />
        <AxButton label="清除密码" variant="destructive" />
        <AxButton label="已禁用" variant="primary" isDisabled />
      </AxHStack>
    </AstryxScope>
  )
}

function OhuInputs() {
  return (
    <>
      <label className={styles.search}>
        <CampusIcon name="search" size={18} />
        <input type="search" placeholder="搜索课程、教室或服务（示例）" aria-label="搜索（示例）" />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel} id="dl-ohu-sid">学号</span>
        <input
          className={styles.fieldInput}
          aria-labelledby="dl-ohu-sid"
          aria-invalid="true"
          aria-describedby="dl-ohu-sid-err"
          defaultValue="2023abc"
        />
        <p className={styles.fieldError} id="dl-ohu-sid-err" role="alert">学号应为纯数字（示例校验）</p>
      </div>
    </>
  )
}

function AstryxInputs() {
  const [query, setQuery] = useState('')
  const [sid, setSid] = useState('2023abc')
  const invalid = sid.trim().length > 0 && !/^\d+$/.test(sid.trim())
  return (
    <AstryxScope>
      <AxVStack gap={3}>
        <AxTextInput
          label="搜索"
          isLabelHidden
          placeholder="搜索课程、教室或服务（示例）"
          type="search"
          value={query}
          onChange={setQuery}
        />
        <AxTextInput
          label="学号"
          value={sid}
          onChange={setSid}
          status={invalid ? { type: 'error', message: '学号应为纯数字（示例校验）' } : undefined}
        />
      </AxVStack>
    </AstryxScope>
  )
}

function OhuTabBar() {
  return (
    <div className={styles.tabbar}>
      {TABS.map((tab, index) => (
        index === 2 ? (
          <span key={tab} className={styles.tabPlus}>
            <span className={styles.tabPlusBtn}><CampusIcon name="plus" size={22} /></span>
            <span className={styles.tabPlusLabel}>{tab}</span>
          </span>
        ) : (
          <span key={tab} className={index === 0 ? `${styles.tab} ${styles.tabOn}` : styles.tab}>
            <CampusIcon name={index === 0 ? 'grid' : index === 1 ? 'shop' : index === 3 ? 'chat' : 'partner'} size={22} />
            <span>{tab}</span>
          </span>
        )
      ))}
    </div>
  )
}

function AstryxTabBar() {
  return (
    <AstryxScope>
      <AxGrid columns={5} gap={1}>
        {TABS.map((tab, index) => (
          <AxButton
            key={tab}
            label={`${tab}（示例）`}
            variant={index === 0 ? 'primary' : 'ghost'}
            size="sm"
          />
        ))}
      </AxGrid>
    </AstryxScope>
  )
}

type Group = {
  id: string
  title: string
  note: string
  ohu: () => ReactElement
  ast: () => ReactElement
}

const GROUPS: readonly Group[] = [
  {
    id: 'brand',
    title: '品牌标题',
    note: '生产中哦狐品牌标题是 h1；本页为保持标题层级降为 h3，视觉一致。Astryx 用 Heading level + Text color/size 令牌。',
    ohu: () => (
      <div className={styles.brand}>
        <h3 className={styles.brandLabel}>下午好，同学！<span aria-hidden="true">✦</span></h3>
        <p className={styles.brandNote}>新的一天也要加油呀！（示例）</p>
      </div>
    ),
    ast: () => (
      <AstryxScope>
        <AxVStack gap={1}>
          <AxHeading level={3}>下午好，同学！</AxHeading>
          <AxText size="sm" color="secondary">新的一天也要加油呀！（示例）</AxText>
        </AxVStack>
      </AstryxScope>
    ),
  },
  {
    id: 'next-class',
    title: '下一节课卡',
    note: '左栏复刻 HomePage 现有 classPreview 时间轴写法（暖渐变底 + 绿点 + tabular-nums 数字）；右栏为 Astryx Card + Stack + Badge。',
    ohu: OhuNextClassCard,
    ast: AstryxNextClassCard,
  },
  {
    id: 'tiles',
    title: '常用功能 tile（默认六项）',
    note: `左栏沿用 home-preferences.ts 默认六项与 CampusIcon 校园域图标；右栏用 Astryx Grid + ClickableCard，但 Astryx 内置图标仅 ${ASTRYX_ICON_NAMES} 个系统级字形（close/check/calendar/search 等），无图书馆/班车/校园卡/餐食等校园图标，需 registerIcons 扩展才能对齐左栏，故右栏暂不配图标。`,
    ohu: OhuTiles,
    ast: AstryxTiles,
  },
  {
    id: 'buttons',
    title: '按钮（主／次／软／危险／禁用）',
    note: '哦狐无共享 Button 组件，靠 CSS Module 类（remindMain/remindGhost 等惯例）；Astryx 提供四个 variant 与 isLoading/isDisabled 语义属性。',
    ohu: OhuButtons,
    ast: AstryxButtons,
  },
  {
    id: 'inputs',
    title: '输入（搜索 + 带错误态字段）',
    note: '哦狐无共享 Input 组件，错误态为各页自写 role="alert" 段落；Astryx TextInput 自带 label、status.type/message 与 aria 关联。',
    ohu: OhuInputs,
    ast: AstryxInputs,
  },
  {
    id: 'empty',
    title: '空态',
    note: '左栏是项目真实共享组件 StateViews.tsx 的 EmptyState（默认文案「这里空空的」）；右栏为 Astryx EmptyState。',
    ohu: () => <OhuEmptyState compact action={<button type="button" className={styles.btnSoft}>去别处逛逛</button>} />,
    ast: () => (
      <AstryxScope>
        <AxEmptyState
          isCompact
          title="这里空空的"
          description="暂时没有内容，去别处逛逛吧"
          actions={<AxButton label="去别处逛逛" variant="secondary" size="sm" />}
        />
      </AstryxScope>
    ),
  },
  {
    id: 'failure',
    title: '失败态',
    note: '左栏为 StateViews.tsx 的 ErrorState（role="alert"）；右栏为 Astryx Banner status="error" + endContent 重试按钮。',
    ohu: () => <OhuErrorState compact action={<button type="button" className={styles.btnSoft}>重试</button>} />,
    ast: () => (
      <AstryxScope>
        <AxBanner
          status="error"
          title="加载失败了"
          description="网络似乎不太顺畅，稍后再试试"
          endContent={<AxButton label="重试" variant="ghost" size="sm" />}
        />
      </AstryxScope>
    ),
  },
  {
    id: 'tabbar',
    title: '底栏样例（固定五项）',
    note: '左栏复刻 TabBar.tsx 的五槽网格（中间圆形发布键）；Astryx 无常驻底部标签栏原语（MobileNav 是 dialog 抽屉、TopNav/SideNav 为顶部与侧边），右栏只能用 Grid + Button 自行组装。',
    ohu: OhuTabBar,
    ast: AstryxTabBar,
  },
] as const

export function DesignLabPage() {
  const [side, setSide] = useState(true)
  const [sid, setSid] = useState('2023abc')
  const sidInvalid = sid.trim().length > 0 && !/^\d+$/.test(sid.trim())

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className={styles.labTag}>隔离试验页 · 非生产入口</span>
        <h1>设计系统试验 · 现有哦狐组件 vs Meta Astryx</h1>
        <p className={styles.note}>
          本页只用于选型对照，不是生产入口：底栏不挂、无其他页面链到本页，Astryx 依赖也只被本文件引用。
          页内课程、时间、学号、倒计时均为样本文案（已标「示例」），非真实数据。
          本页不改任何现有页面组件、不改皮肤机制（skins.css / ui-variant.ts）、不改默认字体、不引用 font-assets 字库。
        </p>
        <div className={styles.modeRow} role="group" aria-label="对照排版方式">
          <button
            type="button"
            className={side ? styles.modeOn : styles.mode}
            aria-pressed={side}
            onClick={() => setSide(true)}
          >
            并排
          </button>
          <button
            type="button"
            className={side ? styles.mode : styles.modeOn}
            aria-pressed={!side}
            onClick={() => setSide(false)}
          >
            上下
          </button>
        </div>
      </header>

      {GROUPS.map((group) => {
        const Ohu = group.ohu
        const Ast = group.ast
        return (
          <section key={group.id} className={styles.group} aria-labelledby={`dl-${group.id}`}>
            <h2 id={`dl-${group.id}`}>{group.title}</h2>
            <p className={styles.groupNote}>{group.note}</p>
            <div className={side ? `${styles.pair} ${styles.pairSide}` : `${styles.pair} ${styles.pairStack}`}>
              <div className={`${styles.col} ${styles.colOhu}`}>
                <span className={styles.colTag}>现有哦狐</span>
                <Ohu />
              </div>
              <div className={`${styles.col} ${styles.colAst}`} data-astryx-theme="neutral" data-theme="light">
                <span className={styles.colTag}>Astryx 0.7.11</span>
                <Ast />
              </div>
            </div>
          </section>
        )
      })}

      <section className={styles.group} aria-labelledby="dl-controlled">
        <h2 id="dl-controlled">受控输入与内联校验（两侧同一状态）</h2>
        <p className={styles.groupNote}>
          同一份 React 状态分别喂给两侧，检验 Astryx 的 status 属性与哦狐自写 aria-invalid + role="alert" 段落的等价性。
        </p>
        <div className={side ? `${styles.pair} ${styles.pairSide}` : `${styles.pair} ${styles.pairStack}`}>
          <div className={`${styles.col} ${styles.colOhu}`}>
            <span className={styles.colTag}>现有哦狐</span>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="dl-c-sid">学号</span>
              <input
                className={styles.fieldInput}
                aria-labelledby="dl-c-sid"
                aria-invalid={sidInvalid}
                aria-describedby={sidInvalid ? 'dl-c-sid-err' : undefined}
                value={sid}
                onChange={(event) => setSid(event.target.value)}
              />
              {sidInvalid ? (
                <p className={styles.fieldError} id="dl-c-sid-err" role="alert">学号应为纯数字（示例校验）</p>
              ) : null}
            </div>
          </div>
          <div className={`${styles.col} ${styles.colAst}`} data-astryx-theme="neutral" data-theme="light">
            <span className={styles.colTag}>Astryx 0.7.11</span>
            <AstryxScope>
              <AxTextInput
                label="学号"
                value={sid}
                onChange={setSid}
                status={sidInvalid ? { type: 'error', message: '学号应为纯数字（示例校验）' } : undefined}
              />
            </AstryxScope>
          </div>
        </div>
      </section>

      <section className={styles.group} aria-labelledby="dl-facts">
        <h2 id="dl-facts">本次核实到的事实（命令取证，非宣传语）</h2>
        <ul className={styles.facts}>
          <li>仓库 <code>meta/astryx</code>（另有 <code>facebook/astryx</code> 同名镜像）：MIT，建于 2026-01-09，首个 release v0.1.1 于 2026-06-26，最新 v0.7.11（2026-11-07），17,978 star / 1,408 fork / 616 open issue，README 自述「Currently in Beta」。</li>
          <li>React 兼容：<code>@astryxdesign/core</code> peerDependencies 为 <code>react&gt;=19.0.0</code>、<code>react-dom&gt;=19.0.0</code>；本项目 react 19.3.0，满足。</li>
          <li>「CSS 变量换主题」属实：<code>theme-neutral/dist/theme.css</code> 24,877 字节、198 个自定义属性，由 <code>astryx theme build</code> 生成，并用 <code>@scope ([data-astryx-theme="neutral"])</code> 限定在子树内。与 <code>src/skins.css</code> 的 63 个令牌名零重名冲突。</li>
          <li>「不绑定样式方案」不完全属实：样式确由 StyleX 写成且无需构建插件，但 276 个 dist JS 文件在运行时 <code>import from '@stylexjs/stylex'</code>，<code>@stylexjs/stylex ^0.19.0</code> 是必需 peer 依赖。</li>
          <li>体积：core 压缩包 7,225,146 字节、解包 28,883,508 字节 / 4,726 文件（dist 18MB、src 15MB 供 swizzle、locales 3.1MB、CHANGELOG 908KB）；预编译 <code>dist/astryx.css</code> 单文件 269,224 字节且全量引入。连带 <code>theme-neutral</code> 依赖 <code>lucide-react</code>（解包 38.5MB / 4,692 文件）。本次安装后 node_modules 由 520MB 增至 606MB。</li>
          <li>组件规模：dist 顶层 120 个目录（扣除 11 个 utils/hooks/theme 类为 109 个组件目录），216 个 .d.ts 声明返回 JSX，447 个首字母大写导出；「150+ 组件」按含子组件计可信。</li>
          <li>浏览器底线上移：Astryx CSS 用 <code>light-dark()</code> 256 次、<code>@property</code> 55 次、<code>:has()</code> 52 次、<code>@scope</code> 4 次、<code>oklch()</code> 15 次；而本项目 src/*.css 现有 <code>color-mix()</code> 259 次、<code>:has()</code> 2 次，<code>light-dark()</code>/<code>@scope</code>/<code>@property</code>/<code>oklch()</code> 均为 0 次。绑定约束是 <code>light-dark()</code>，需 Chrome / Android WebView 123+。</li>
          <li>层级冲突风险：<code>astryx.css</code> 与 <code>theme.css</code> 都在 <code>@layer</code> 内，而本项目 <code>index.css</code> 的 <code>button</code>／<code>:where(input,select)</code> 等全局重置是未分层的——未分层样式恒胜过 layered 样式，故 Astryx 按钮/输入会被现有全局重置覆盖。</li>
          <li>供应链：<code>core</code> 有 <code>postinstall</code> 脚本，已逐行读过 <code>scripts/postinstall.mjs</code>（103 行）——仅打印「运行 astryx init」提示，无网络请求、<code>.catch()</code> 兜底且 <code>process.exit(0)</code>，不会让安装失败。</li>
        </ul>
      </section>

      <p className={styles.foot}>
        本页引入的 npm 依赖仅供此试验页使用：@astryxdesign/core@0.7.11、@astryxdesign/theme-neutral@0.7.11、@stylexjs/stylex@0.19.0（均为 MIT）。
        未全局替换任何现有组件，未改 src/skins.css、src/lib/ui-variant.ts、src/fonts.css，未引用 font-assets/ 字库，未做 OTA / APK / 部署。
        若结论为不采纳，删除本文件、design-lab.module.css、App.tsx 中一行路由并还原 package.json / package-lock.json 即可完全回退。
      </p>
    </div>
  )
}
