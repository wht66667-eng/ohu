/**
 * 江苏海洋大学 · 综合测评资料库
 *
 * 来源均为学校 / 学院官网公开文件，整理后便于查阅与材料自查。
 * 学院细则以学工办最新通知为准；无独立公开细则的学院沿用校级办法并标注。
 */

export type ZhongceSource = {
  title: string
  url: string
  note?: string
}

export type BonusItem = {
  id: string
  category: string
  title: string
  points: string
  materials: string[]
}

export type CollegeZhongce = {
  id: string
  name: string
  short: string
  /** has_detail=本院公开细则；school_only=暂按校级办法 */
  mode: 'has_detail' | 'school_only'
  updated: string
  sources: ZhongceSource[]
  highlights: string[]
  bonuses: BonusItem[]
  /** 本院特别提醒（材料、流程） */
  tips: string[]
}

/** 校级统一公式与素质拓展框架（江海大〔2021〕127号） */
export const SCHOOL_FORMULA = {
  culture: 0.6,
  honesty: 0.15,
  daily: 0.1,
  expand: 0.15,
  text: '学年综测总分 = 文化成绩均分×60% + 文明诚信分×15% + 日常行为分×10% + 素质拓展分×15%',
}

export const SCHOOL_SOURCE: ZhongceSource = {
  title: '江苏海洋大学本科生综合测评实施办法（修订）',
  url: 'https://xuesc.jou.edu.cn/info/1054/3617.htm',
  note: '学生工作处 · 江海大〔2021〕127号',
}

/** 校级素质拓展加分（所有学院通用底盘） */
export const SCHOOL_BONUSES: BonusItem[] = [
  {
    id: 's-honor',
    category: '评奖评优',
    title: '市级 / 省级 / 国家级三好、优干、优秀团干等',
    points: '每次 4~8 分',
    materials: ['荣誉证书原件及复印件', '表彰文件或官网公示截图'],
  },
  {
    id: 's-class',
    category: '评奖评优',
    title: '省级先进班集体成员',
    points: '班长/团支书 6；其他班委 4；其他同学 3',
    materials: ['先进班集体证书或文件', '任职证明'],
  },
  {
    id: 's-core',
    category: '评奖评优',
    title: '社会主义核心价值观培育班 / 示范班',
    points: '培育班 2~4；示范班 4~6（按职务）',
    materials: ['班级获评文件', '任职证明'],
  },
  {
    id: 's-cadre',
    category: '学生干部',
    title: '各级学生干部 / 团干部突出表现',
    points: '学院视表现 2~5 分',
    materials: ['任职聘书或红头文件', '学年工作总结 / 考核证明'],
  },
  {
    id: 's-contest',
    category: '学科竞赛',
    title: '市级及以上学科竞赛 / 挑战杯 / 创青春等',
    points: '视情况 3~8 分（同项取最高）',
    materials: ['获奖证书', '参赛名单或指导教师证明'],
  },
  {
    id: 's-research',
    category: '科研学术',
    title: '校级及以上课题结题',
    points: '视级别 3~8 分',
    materials: ['立项 / 结题证明', '成员名单'],
  },
  {
    id: 's-patent',
    category: '科研学术',
    title: '发明 / 专利',
    points: '视情况 3~8 分',
    materials: ['专利受理 / 授权文件', '发明人排名页'],
  },
  {
    id: 's-paper',
    category: '科研学术',
    title: '报刊作品 / 学术论文',
    points: '视刊物与作者顺序 1~8 分',
    materials: ['刊物封面目录与正文', '检索证明（如有）'],
  },
  {
    id: 's-cet',
    category: '证书技能',
    title: '英语四六级 / 计算机二三级',
    points: '四级 3、六级 5、计算机二级 3、三级 5',
    materials: ['成绩单或电子报告单', '准考证号备查'],
  },
  {
    id: 's-skill',
    category: '证书技能',
    title: '其他专业技能 / 职业资格证',
    points: '参照相近等级 1~5 分',
    materials: ['资格证书原件及复印件'],
  },
  {
    id: 's-exchange',
    category: '交流学习',
    title: '出国研修 / 校际交流完成任务',
    points: '4~6 分',
    materials: ['派出文件', '成绩单或结业证明'],
  },
  {
    id: 's-dual',
    category: '交流学习',
    title: '辅修二专业结业 / 自考二学历完成',
    points: '4~6 分',
    materials: ['结业证或学籍证明'],
  },
  {
    id: 's-sport',
    category: '文体活动',
    title: '破校 / 市 / 省 / 国家级体育纪录',
    points: '3~8 分',
    materials: ['竞赛秩序册与成绩证明'],
  },
  {
    id: 's-art',
    category: '文体活动',
    title: '课外文体活动获奖（院~国家级）',
    points: '1~8 分',
    materials: ['获奖证书', '活动主办方证明'],
  },
  {
    id: 's-dorm',
    category: '宿舍',
    title: '文明宿舍 / 流动红旗',
    points: '文明宿舍 2~3；流动红旗每次 2',
    materials: ['宿舍获评公示或证书'],
  },
  {
    id: 's-safety',
    category: '其他',
    title: '报告并协助处理涉学生安全隐患 / 突发事件',
    points: '2~8 分',
    materials: ['学院认定说明'],
  },
  {
    id: 's-extra',
    category: '其他',
    title: '设项外突出表现',
    points: '学院酌情 1~8 分',
    materials: ['书面事迹说明', '证明材料'],
  },
]

const APPLY_TECH: CollegeZhongce = {
  id: 'yingyong',
  name: '应用技术学院',
  short: '应技',
  mode: 'has_detail',
  updated: '2024-09',
  sources: [
    SCHOOL_SOURCE,
    {
      title: '应用技术学院学生综合测评实施细则（2024年修订版）',
      url: 'http://dgxy.jou.edu.cn/info/1057/6340.htm',
      note: '本院最新公开细则',
    },
  ],
  highlights: [
    '素质拓展分封顶 100 分',
    '学科竞赛须在学校当年认定名单内，且以海大为第一单位',
    '优秀奖 / 优胜奖、多数网络竞赛不加分（英语类竞赛除外）',
    '社团加分每人最多叠加 3 个社团',
  ],
  tips: [
    '平时填《文明诚信档案》与《班级综合测评明细表》，学年公示签字后交学工办。',
    '竞赛证书、四六级成绩单、任职证明务必留扫描件备份。',
  ],
  bonuses: [
    {
      id: 'y-honor',
      category: '评奖评优',
      title: '优秀团员 / 团干 / 班干 / 三好学生',
      points: '国家级 8 · 省级 6 · 市级 4 · 校级 3',
      materials: ['荣誉证书', '表彰文件'],
    },
    {
      id: 'y-contest',
      category: '学科竞赛',
      title: '学科竞赛 / 创新创业技能大赛',
      points: '国一/二/三：8/7/6；省一/二/三：6/5/4；市级 4、校级 3',
      materials: ['获奖证书', '认定名单内项目证明', '第一单位为海大'],
    },
    {
      id: 'y-plan',
      category: '学科竞赛',
      title: '策划案类双创竞赛',
      points: '国家级 6 · 省级 5 · 市级 4 · 校级 3',
      materials: ['获奖证书'],
    },
    {
      id: 'y-art',
      category: '文体活动',
      title: '课外文体获奖',
      points: '国家 8 · 省 6 · 市 4 · 校 3 · 院 2；综测条累计上限 5 分',
      materials: ['奖状或综测加分条（不重复）'],
    },
    {
      id: 'y-practice',
      category: '社会实践',
      title: '暑期社会实践优秀团队 / 先进个人',
      points: '省/市/校/院：6/4/3/2',
      materials: ['实践证书或公示文件'],
    },
    {
      id: 'y-cet',
      category: '证书技能',
      title: '四六级 / 计算机 / 普通话 / SYB / CAD',
      points: '四级·计二 3；六级·计三 5；SYB/CAD 5；普通话二级 2',
      materials: ['成绩单或合格证书'],
    },
    {
      id: 'y-ielts',
      category: '证书技能',
      title: '雅思 / 托福 / GRE 等',
      points: '雅思≥6：5；<6：3；托福 GRE 等 6',
      materials: ['官方成绩单'],
    },
    {
      id: 'y-cadre',
      category: '学生干部',
      title: '校院学生组织 / 班委 / 楼长层长',
      points: '校主席级约 12；部长级约 10；班长团支书学委 6；其他班委 4 等（详见细则）',
      materials: ['任职证明', '学年满一年证明'],
    },
    {
      id: 'y-dorm',
      category: '宿舍',
      title: '全 A 宿舍 / 文明宿舍 / 流动红旗',
      points: '全 A 额外舍长 3、成员 2；文明宿舍 2~3；流动红旗 2',
      materials: ['宿舍检查记录或获评公示'],
    },
  ],
}

const CHEM: CollegeZhongce = {
  id: 'huagong',
  name: '环境与化学工程学院',
  short: '环化',
  mode: 'has_detail',
  updated: '细则页公开（请以学工办最新版为准）',
  sources: [
    SCHOOL_SOURCE,
    {
      title: '化学工程学院学生综合测评细则（学院网公开稿）',
      url: 'https://ce.jou.edu.cn/',
      note: '旧称化学工程学院细则；具体分值以学院学工办当年通知为准',
    },
  ],
  highlights: [
    '鼓励专业相关资格考证（如化学检验工等），通过后在基础分上再加',
    '计算机二 / 三级在本院细则中分值可能高于校级通用表述，以本院文件为准',
  ],
  tips: [
    '专业类证书、实验实训获奖材料单独建文件夹，交材料时对照班级测评小组清单。',
    '若官网细则链接失效，直接问辅导员或学工办要 PDF。',
  ],
  bonuses: [
    {
      id: 'c-chem',
      category: '证书技能',
      title: '化学检验工 / 化学试验工等专业相关证书',
      points: '通过后在基础加分上再加（详见本院细则，常见可至约 10 分档）',
      materials: ['职业资格证书', '考试合格证明'],
    },
    {
      id: 'c-comp',
      category: '证书技能',
      title: '计算机等级（本院细则）',
      points: '以本院最新细则为准（公开稿曾写二级、三级较高加分）',
      materials: ['NCRE 证书 / 成绩单'],
    },
    ...SCHOOL_BONUSES.filter((b) => !['s-cet', 's-skill'].includes(b.id)),
  ],
}

const SCIENCE: CollegeZhongce = {
  id: 'lixue',
  name: '理学院',
  short: '理学',
  mode: 'has_detail',
  updated: '学院补充意见 / 管理规定（请核对是否仍适用现行校办法）',
  sources: [
    SCHOOL_SOURCE,
    {
      title: '理学院学生综合测评分管理规定（学院网）',
      url: 'https://ss.jou.edu.cn/info/1286/1936.htm',
      note: '部分表述源自淮海工学院时期文件，务必向本院确认现行有效版本',
    },
  ],
  highlights: [
    '历史上曾将奖励分分为 A 类基础分与 B 类提高分，并设学期上限',
    '竞赛加分常按国 / 省 / 校 / 院分档，文体与体育另有破纪录加分',
  ],
  tips: [
    '理学院文件年代可能较早，交材料前让学委核对「现行计分表」。',
    '综测条、竞赛证书、四六级成绩单是常见凭证。',
  ],
  bonuses: [
    {
      id: 'l-contest',
      category: '学科竞赛',
      title: '专业类竞赛（公开稿分档示例）',
      points: '全国约 13~18；省级约 7~13；校级约 4~8；院级约 2~4（以现行文件为准）',
      materials: ['获奖证书', '指导教师证明'],
    },
    {
      id: 'l-art',
      category: '文体活动',
      title: '文艺类竞赛',
      points: '省级约 5~7；市级约 4~6；校院更低档（以现行文件为准）',
      materials: ['获奖证书'],
    },
    {
      id: 'l-pe',
      category: '文体活动',
      title: '体育竞赛名次 / 破纪录 / 体测优秀',
      points: '按名次与纪录级别加分；体测优秀常见约 3 分',
      materials: ['成绩册', '体测优秀证明'],
    },
    ...SCHOOL_BONUSES.filter((b) => b.category === '证书技能' || b.category === '学生干部'),
  ],
}

function schoolOnlyCollege(
  id: string,
  name: string,
  short: string,
  site: string,
): CollegeZhongce {
  return {
    id,
    name,
    short,
    mode: 'school_only',
    updated: '沿用校级办法',
    sources: [
      SCHOOL_SOURCE,
      { title: `${name}官网（查本院通知）`, url: site, note: '请在本院「学生工作 / 通知公告」检索综测细则' },
    ],
    highlights: [
      '暂未在公开检索中找到完整现行细则 PDF，先按校级办法准备材料',
      '学院可在校级框架上提高或细化分值，最终以辅导员 / 学工办通知为准',
    ],
    tips: [
      '材料按校级素质拓展 17 类准备：证书、竞赛、任职、宿舍、实践缺一不可。',
      '收到本院细则后，把 PDF 发给班委统一解读，再对照本页勾选。',
    ],
    bonuses: SCHOOL_BONUSES,
  }
}

/** 海大主要学院（公开细则优先，其余校级兜底 + 官网入口） */
export const COLLEGES: CollegeZhongce[] = [
  APPLY_TECH,
  CHEM,
  SCIENCE,
  schoolOnlyCollege('haiyang', '海洋科学与水产学院', '海科', 'https://hyxy.jou.edu.cn/'),
  schoolOnlyCollege('haice', '海洋技术与测绘学院', '海测', 'https://oceangeo.jou.edu.cn/'),
  schoolOnlyCollege('shipin', '食品科学与工程学院', '食品', 'https://spxy.jou.edu.cn/'),
  schoolOnlyCollege('jixie', '机械工程学院', '机械', 'https://me.jou.edu.cn/'),
  schoolOnlyCollege('dianzi', '电子信息工程学院', '电信', 'https://eit.jou.edu.cn/'),
  schoolOnlyCollege('shang', '商学院', '商院', 'https://sxy.jou.edu.cn/'),
  schoolOnlyCollege('wenfa', '文法学院', '文法', 'https://wgyxy.jou.edu.cn/'),
  schoolOnlyCollege('waiyu', '外国语学院', '外语', 'https://wgy.jou.edu.cn/'),
  schoolOnlyCollege('tumugang', '土木与港航工程学院', '土木港航', 'https://tm.jou.edu.cn/'),
  schoolOnlyCollege('chuangxin', '创新创业学院', '双创', 'https://gxzx.jou.edu.cn/'),
]

export const MATERIAL_PACK = [
  { id: 'm1', title: '成绩单 / 排名证明', desc: '教务打印或截图，用于文化成绩 60%' },
  { id: 'm2', title: '四六级 / 计算机成绩单', desc: '电子报告单 PDF 或照片' },
  { id: 'm3', title: '竞赛获奖证书', desc: '封面+姓名页；注明项目是否在认定名单' },
  { id: 'm4', title: '学生干部任职证明', desc: '聘书、红头文件或学工系统任职页' },
  { id: 'm5', title: '荣誉称号证书', desc: '三好、优干、优秀团员等' },
  { id: 'm6', title: '论文 / 专利 / 课题材料', desc: '检索页、授权书、结题证明' },
  { id: 'm7', title: '宿舍获评证明', desc: '文明宿舍、流动红旗公示' },
  { id: 'm8', title: '社会实践证明', desc: '优秀团队 / 先进个人证书' },
  { id: 'm9', title: '综测平时记录表', desc: '班级测评小组签字版' },
  { id: 'm10', title: '文明诚信档案', desc: '无 * 号扣分记录截图或盖章页' },
]

export function calcZhongceTotal(input: {
  culture: number
  honesty: number
  daily: number
  expand: number
}): number {
  const t =
    input.culture * SCHOOL_FORMULA.culture +
    input.honesty * SCHOOL_FORMULA.honesty +
    input.daily * SCHOOL_FORMULA.daily +
    input.expand * SCHOOL_FORMULA.expand
  return Math.round(t * 100) / 100
}
