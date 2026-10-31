export interface OwnerTicket { owner: string; revision: number; lane?: string; request?: number }

/** Late work must match both its owner and its request generation, including A → B → A. */
export class AsyncOwner {
  owner: string
  private revision = 0
  private lanes = new Map<string, number>()
  constructor(owner = '') { this.owner = owner }
  select(owner: string) {
    if (owner !== this.owner) { this.owner = owner; this.invalidate() }
  }
  invalidate() { this.revision++; this.lanes.clear() }
  capture(): OwnerTicket { return { owner: this.owner, revision: this.revision } }
  begin(lane: string): OwnerTicket {
    const request = (this.lanes.get(lane) || 0) + 1
    this.lanes.set(lane, request)
    return { ...this.capture(), lane, request }
  }
  current(ticket: OwnerTicket) {
    return ticket.owner === this.owner && ticket.revision === this.revision &&
      (!ticket.lane || this.lanes.get(ticket.lane) === ticket.request)
  }
}

export function positiveRecordId(raw: unknown): number | null {
  const text = String(raw ?? '')
  if (!/^[1-9]\d*$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

export function ownedRows<T extends { buyer_uid: string }>(uid: string, owner: string, rows: T[]): T[] {
  return uid && owner === uid ? rows.filter((row) => row.buyer_uid === uid) : []
}
