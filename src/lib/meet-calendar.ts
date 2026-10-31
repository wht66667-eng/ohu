import type { MeetRoom } from './meet-api'

const utf8 = new TextEncoder()

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function parseChinaDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  const parts = [y, mo, d, h, mi].map(Number)
  const [year, month, day, hour, minute] = parts
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60_000)
  const check = new Date(local.getTime() + 8 * 60 * 60_000)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null
  return local
}

function formatUtc(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}00Z`
}

function foldIcsLine(line: string): string[] {
  const folded: string[] = []
  let current = ''
  let byteLength = 0
  for (const character of line) {
    const size = utf8.encode(character).length
    if (byteLength + size > 75 && current) {
      folded.push(current)
      current = ` ${character}`
      byteLength = 1 + size
    } else {
      current += character
      byteLength += size
    }
  }
  if (current) folded.push(current)
  return folded
}

/** Export only the confirmed activity time; the meeting place is not part of the current activity model. */
export function buildMeetIcs(room: MeetRoom, activityLabel: string, now = new Date()): string | null {
  if (!room.confirmedStart || !room.confirmedEnd) return null
  const start = parseChinaDateTime(room.confirmedStart)
  const end = parseChinaDateTime(room.confirmedEnd)
  if (!start || !end || end <= start) return null
  const safeId = room.id.replace(/[^a-zA-Z0-9-]/g, '')
  if (!safeId) return null
  const summary = [activityLabel, room.title].filter(Boolean).join(' · ')
  const description = [
    `哦狐碰个空活动：${room.title}`,
    room.campus ? `校区：${room.campus}` : '',
    '集合地点尚未确认，请回到活动页与成员商议。',
  ].filter(Boolean).join('\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OHU//Meet Activity//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:ohu-meet-${safeId}@ohu.local`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].flatMap(foldIcsLine).join('\r\n')
}
