/** A late account read may never restore another account's privileges. */
export class SessionReadGuard {
  private revision = 0
  uid = ''
  begin() { return ++this.revision }
  current(ticket: number) { return ticket === this.revision }
  select(ticket: number, uid: string) {
    if (!this.current(ticket)) return false
    this.uid = uid
    return true
  }
  accepts(ticket: number, uid: string) { return this.current(ticket) && this.uid === uid }
  reset() { this.uid = ''; this.revision++ }
}
