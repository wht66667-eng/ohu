type BackPlan = { delta: number } | { to: string }
const studyRoutes = new Set(['/study', '/study/focus'])

/** Only the study/focus pair has parent-return semantics; other pages keep normal back. */
export function createStudyBackHistory() {
  const routes = new Map<number, string>()
  return {
    record(index: number | undefined, pathname: string, action: string) {
      if (!Number.isInteger(index) || index! < 0) return
      const current = index!
      if (action === 'PUSH') {
        for (const key of routes.keys()) if (key >= current) routes.delete(key)
      }
      routes.set(current, pathname)
      // Keep this tab's recent app routes only; never persist another browser's history.
      for (const key of routes.keys()) if (key < current - 96) routes.delete(key)
    },
    plan(index: number | undefined, pathname: string): BackPlan | null {
      if (!studyRoutes.has(pathname)) return null
      if (!Number.isInteger(index) || index! <= 0) return { to: pathname === '/study/focus' ? '/study' : '/' }
      const current = index!
      if (pathname === '/study/focus') {
        return routes.get(current - 1) === '/study' ? { delta: -1 } : { to: '/study' }
      }
      for (let previous = current - 1; previous >= 0; previous--) {
        const route = routes.get(previous)
        if (!route) break // Unobserved entries may belong to an external page.
        if (!studyRoutes.has(route)) return { delta: previous - current }
      }
      return { to: '/' }
    },
  }
}

export const studyBackHistory = createStudyBackHistory()
