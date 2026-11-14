/**
 * 教练契约四视图（今日 / 计划 / 关系 / 复盘）· 纯函数，确定性可解释，不落库。
 * 输入均为已通过校验的 TaskContract；视图只读，编辑在页面内存中进行后重新校验。
 */
import type { CoachTask, TaskContract } from './contract.ts'

export interface TodayTaskView {
  task: CoachTask
  /** 前置任务全部完成才可开始 */
  ready: boolean
  blockedBy: string[]
}

export interface TodayView {
  date: string
  tasks: TodayTaskView[]
  totalMinutes: number
  readyCount: number
  blockedCount: number
  doneCount: number
}

export interface PlanDay {
  date: string
  tasks: CoachTask[]
  totalMinutes: number
}

export interface PlanView {
  days: PlanDay[]
  taskCount: number
  totalMinutes: number
}

export interface RelationNode {
  task: CoachTask
  prerequisites: CoachTask[]
  dependents: CoachTask[]
}

export interface RelationsView {
  nodes: RelationNode[]
  /** 无环时的拓扑顺序（前置在前）；有环时为空 */
  order: string[]
  hasCycle: boolean
  edgeCount: number
}

export interface CategoryStat {
  category: string
  total: number
  done: number
}

export interface ReviewView {
  total: number
  done: number
  /** 0..1 */
  rate: number
  minutesTotal: number
  minutesDone: number
  unfinished: CoachTask[]
  byCategory: CategoryStat[]
}

function byId(contract: TaskContract): Map<string, CoachTask> {
  return new Map(contract.tasks.map(t => [t.id, t]))
}

export function todayView(contract: TaskContract, todayKey: string): TodayView {
  const map = byId(contract)
  const tasks = contract.tasks
    .filter(t => t.date === todayKey)
    .map(task => {
      const blockedBy = task.dependsOn
        .map(id => map.get(id))
        .filter((dep): dep is CoachTask => !!dep && !dep.done)
        .map(dep => dep.title || dep.id)
      return { task, ready: blockedBy.length === 0, blockedBy }
    })
    .sort((a, b) => Number(a.ready) - Number(b.ready) === 0 ? a.task.title.localeCompare(b.task.title, 'zh-CN') : Number(b.ready) - Number(a.ready))
  return {
    date: todayKey,
    tasks,
    totalMinutes: tasks.reduce((sum, t) => sum + t.task.minutes, 0),
    readyCount: tasks.filter(t => t.ready).length,
    blockedCount: tasks.filter(t => !t.ready).length,
    doneCount: tasks.filter(t => t.task.done).length,
  }
}

export function planView(contract: TaskContract): PlanView {
  const groups = new Map<string, CoachTask[]>()
  for (const task of contract.tasks) {
    const list = groups.get(task.date) ?? []
    list.push(task)
    groups.set(task.date, list)
  }
  const days = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, tasks]) => ({
      date,
      tasks: [...tasks].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
      totalMinutes: tasks.reduce((sum, t) => sum + t.minutes, 0),
    }))
  return {
    days,
    taskCount: contract.tasks.length,
    totalMinutes: contract.tasks.reduce((sum, t) => sum + t.minutes, 0),
  }
}

export function relationsView(contract: TaskContract): RelationsView {
  const map = byId(contract)
  const nodes: RelationNode[] = contract.tasks.map(task => ({
    task,
    prerequisites: task.dependsOn.map(id => map.get(id)).filter((t): t is CoachTask => !!t),
    dependents: contract.tasks.filter(other => other.dependsOn.includes(task.id)),
  }))
  const edgeCount = contract.tasks.reduce((sum, t) => sum + t.dependsOn.filter(id => map.has(id)).length, 0)

  // Kahn 拓扑排序：无环时给出「前置在前」的执行顺序。
  const indegree = new Map(contract.tasks.map(t => [t.id, t.dependsOn.filter(id => map.has(id)).length]))
  const queue = contract.tasks.filter(t => (indegree.get(t.id) ?? 0) === 0).map(t => t.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const other of contract.tasks) {
      if (!other.dependsOn.includes(id)) continue
      const next = (indegree.get(other.id) ?? 0) - 1
      indegree.set(other.id, next)
      if (next === 0) queue.push(other.id)
    }
  }
  const hasCycle = order.length !== contract.tasks.length
  return { nodes, order: hasCycle ? [] : order, hasCycle, edgeCount }
}

export function reviewView(contract: TaskContract): ReviewView {
  const total = contract.tasks.length
  const done = contract.tasks.filter(t => t.done).length
  const minutesTotal = contract.tasks.reduce((sum, t) => sum + t.minutes, 0)
  const minutesDone = contract.tasks.filter(t => t.done).reduce((sum, t) => sum + t.minutes, 0)
  const categories = new Map<string, CategoryStat>()
  for (const task of contract.tasks) {
    const stat = categories.get(task.category) ?? { category: task.category, total: 0, done: 0 }
    stat.total += 1
    if (task.done) stat.done += 1
    categories.set(task.category, stat)
  }
  return {
    total,
    done,
    rate: total ? done / total : 0,
    minutesTotal,
    minutesDone,
    unfinished: contract.tasks.filter(t => !t.done),
    byCategory: [...categories.values()].sort((a, b) => b.total - a.total),
  }
}