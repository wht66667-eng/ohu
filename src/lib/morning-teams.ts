import { cbRdb } from './cb'
import type { Activity, QueryRes } from './bulletin'
import { isMorningTeam, MORNING_TEAM_CATEGORY, MORNING_TEAM_TAGS } from './morning-team-rules'

export interface MorningTeam extends Activity {
  joined: boolean
  owned: boolean
  signupCountKnown: boolean
  viewerUid: string
}

type Query = any
function errorMessage(error: unknown): string {
  const message = typeof error === 'string' ? error : (error as { message?: string })?.message
  if (/does not exist|column|schema cache|relation.*not found/i.test(message || '')) return '组队数据尚未配置完整，请联系管理员检查活动表与报名权限'
  return message || '暂时无法读取小队，请检查网络后重试'
}

/** Query the tag on the server, so 30 unrelated team-up rows cannot hide squads. */
export async function fetchMorningTeams(uid = ''): Promise<QueryRes<MorningTeam>> {
  try {
    const db = cbRdb()
    const publicQuery = (db.from('v_activities_public') as Query).select('*')
      .eq('category', MORNING_TEAM_CATEGORY).in('tag', MORNING_TEAM_TAGS).eq('status', 'open').gt('start_at', new Date().toISOString()).order('start_at', { ascending: true }).limit(100)
    const [publicRows, ownRows, signups] = await Promise.all([
      publicQuery,
      uid ? (db.from('activities') as Query).select('*').eq('creator_uid', uid).eq('category', MORNING_TEAM_CATEGORY).in('tag', MORNING_TEAM_TAGS).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
      uid ? (db.from('activity_signups') as Query).select('activity_id').eq('uid', uid).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    ])
    for (const result of [publicRows, ownRows, signups]) if (result?.error) return { rows: [], error: errorMessage(result.error) }
    const signupIds = Array.from(new Set<number>((signups?.data || []).map((row: { activity_id: number }) => Number(row.activity_id)).filter((id: number) => Number.isSafeInteger(id) && id > 0)))
    // Keep ended/cancelled joined squads visible under My squads.
    const joinedRows = signupIds.length ? await (db.from('activities') as Query).select('*').in('id', signupIds).eq('category', MORNING_TEAM_CATEGORY).in('tag', MORNING_TEAM_TAGS).order('created_at', { ascending: false }).limit(100) : { data: [] }
    if (joinedRows?.error) return { rows: [], error: errorMessage(joinedRows.error) }
    const ownIds = new Set<number>((ownRows?.data || []).map((row: Activity) => Number(row.id)))
    const joinedIds = new Set(signupIds)
    const merged = new Map<number, Activity>()
    // The public view has aggregate signup_count; give it priority over main-table fields.
    for (const row of [...(ownRows?.data || []), ...(joinedRows?.data || []), ...(publicRows?.data || [])] as Activity[]) {
      if (isMorningTeam(row) && Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0) merged.set(Number(row.id), row)
    }
    return {
      rows: [...merged.values()].map((row) => ({ ...row, id: Number(row.id), signup_count: Number(row.signup_count) || 0, signupCountKnown: row.signup_count != null && Number.isFinite(Number(row.signup_count)), joined: joinedIds.has(Number(row.id)), owned: ownIds.has(Number(row.id)), viewerUid: uid }))
        .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))),
      error: null,
    }
  } catch (error) {
    return { rows: [], error: errorMessage(error) }
  }
}
