/**
 * 确定性示例契约（M4 离线预览用）· 不联网、不登录即可跑通四视图与校验。
 * 以「今天」为起点生成 7 天排期，含前置依赖、已完成项与多分类，便于演示今日/计划/关系/复盘。
 */
import { CONTRACT_SCHEMA, CONTRACT_VERSION, type TaskContract } from './contract.ts'

/** 日期键加 n 天（UTC，避免本地时区漂移）。 */
export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function buildSampleContract(todayKey: string): TaskContract {
  const day = (n: number) => addDays(todayKey, n)
  return {
    schema: CONTRACT_SCHEMA,
    version: CONTRACT_VERSION,
    title: '本周学习节奏（示例）',
    horizon: { start: day(0), end: day(6) },
    tasks: [
      { id: 't1', title: '高数·极限习题', date: day(0), minutes: 45, dependsOn: [], category: '课程', done: true, note: '已完成，作为导数预习的前置' },
      { id: 't2', title: '英语·四级词汇 50', date: day(0), minutes: 30, dependsOn: [], category: '考试', done: false, note: '' },
      { id: 't3', title: '高数·导数预习', date: day(1), minutes: 40, dependsOn: ['t1'], category: '课程', done: false, note: '依赖极限习题' },
      { id: 't4', title: '线代·矩阵练习', date: day(1), minutes: 35, dependsOn: [], category: '课程', done: false, note: '' },
      { id: 't5', title: '四级·真题阅读', date: day(2), minutes: 60, dependsOn: ['t2'], category: '考试', done: false, note: '依赖词汇积累' },
      { id: 't6', title: '专业课·章节复盘', date: day(3), minutes: 50, dependsOn: ['t3', 't4'], category: '复习', done: false, note: '依赖两门课进度' },
      { id: 't7', title: '错题整理', date: day(4), minutes: 25, dependsOn: ['t6'], category: '复习', done: false, note: '' },
      { id: 't8', title: '模拟卷自测', date: day(5), minutes: 90, dependsOn: ['t5', 't7'], category: '考试', done: false, note: '周末整卷检验' },
    ],
  }
}