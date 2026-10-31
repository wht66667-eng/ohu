import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getAppShell } from '../lib/app-shell'
import { guardRedirect } from '../lib/shell-guard'
import { useAuth } from '../lib/auth'

/** 工作壳误入学生页时，重定向回本端首页 */
export function ShellRouteGuard() {
  const loc = useLocation()
  const nav = useNavigate()
  const auth = useAuth()
  const isAdmin = auth.isSigned && !!auth.profile?.isAdmin
  const isSuperAdmin = auth.isSigned && !!auth.profile?.isSuperAdmin

  useEffect(() => {
    const shell = getAppShell()
    const to = guardRedirect(loc.pathname, shell, { isAdmin, isSuperAdmin })
    if (to && to !== loc.pathname) {
      nav(to, { replace: true })
    }
  }, [loc.pathname, nav, isAdmin, isSuperAdmin])

  return null
}
