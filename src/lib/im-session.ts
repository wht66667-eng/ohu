import { AsyncOwner, type OwnerTicket } from './async-owner'

const session = new AsyncOwner()
const listeners = new Set<() => void>()

/** Called synchronously by Auth before rendering a different account. No SDK import. */
export function selectImSession(uid: string | null) {
  const next = uid || ''
  if (session.owner === next) return
  session.select(next)
  listeners.forEach((listener) => listener())
}
export function captureImSession(uid: string): OwnerTicket | null {
  return uid && uid === session.owner ? session.capture() : null
}
export function currentImSession(ticket: OwnerTicket | null): boolean {
  return !!ticket && session.current(ticket)
}
export function imSessionUid() { return session.owner }
export function subscribeImSession(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
