import { useSyncExternalStore } from 'react'
import { loadScheduleCache } from '../lib/schedule-cache'
import type { TtRow } from '../lib/timetable'
import { loadGradesCache, loadExamsCache, type GradeRowRemote, type ExamRowRemote } from '../lib/academic-cache'
import { listPhysicalTestResults, type PhysicalTestRecord } from '../lib/physical-test-results'
import { readPocketUni } from '../lib/pocketuni-store'
import type { PuSummary } from '../lib/pocketuni-parse'
import { readQuality } from '../lib/quality-store'
import type { QualitySummary } from '../lib/quality-parse'
import { readPublicElectives, type ElectiveOffering } from '../lib/public-elective'
import { readChaoxingCourses } from '../lib/chaoxing-store'
import type { ChaoxingCourse } from '../lib/chaoxing-parse'
import { listLocalTodos } from '../lib/local-todos'
import type { TodoRow } from '../lib/todo'

/** 学业数据中心：所有页面共享一份状态，localStorage 只作为持久化适配器。 */
export interface SchoolState {
  hydrated: boolean
  schedule: TtRow[]
  grades: GradeRowRemote[]
  exams: ExamRowRemote[]
  tice: PhysicalTestRecord[]
  pu: PuSummary | null
  quality: QualitySummary | null
  publicElective: ElectiveOffering[]
  chaoxing: ChaoxingCourse[]
  todos: TodoRow[]
}

let state: SchoolState = {
  hydrated: false,
  schedule: [],
  grades: [],
  exams: [],
  tice: [],
  pu: null,
  quality: null,
  publicElective: [],
  chaoxing: [],
  todos: [],
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getSchoolState(): SchoolState {
  return state
}

function replace(next: Partial<SchoolState>) {
  state = { ...state, ...next }
  emit()
}

export function subscribeSchool(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 从各持久化缓存刷新内存状态；页面不再各自读 localStorage。 */
export function refreshSchool(): void {
  replace({
    hydrated: true,
    schedule: loadScheduleCache().rows,
    grades: loadGradesCache(),
    exams: loadExamsCache(),
    tice: listPhysicalTestResults(),
    pu: readPocketUni(),
    quality: readQuality(),
    publicElective: readPublicElectives(),
    chaoxing: readChaoxingCourses()?.courses ?? [],
    todos: listLocalTodos(),
  })
}

export function useSchool<T>(selector: (value: SchoolState) => T): T {
  return useSyncExternalStore(subscribeSchool, () => selector(state), () => selector(state))
}
