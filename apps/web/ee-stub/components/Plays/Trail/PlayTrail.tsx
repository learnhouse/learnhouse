// OSS stub: Plays require Enterprise Edition. The trail shows no Play
// numbers and no badge grids.

export type TrailBadge = {
  playground_uuid: string
  play_name: string
  name: string
  emoji: string
  color: string
  description: string
  score: number
  awarded_at: string
}

export type BadgeToEarn = {
  playUuid: string
  playName: string
  name: string
  emoji?: string | null
  color?: string | null
  description?: string | null
}

export function usePlayTrail(_args: {
  userId?: number
  orgId?: number
  accessToken?: string
  enabled: boolean
}): { badges: TrailBadge[] | null; streakDays: number | null } {
  return { badges: null, streakDays: null }
}

export function usePlayBadgesToEarn(_args: {
  orgId?: number
  accessToken?: string
  earned: TrailBadge[] | null | undefined
}): BadgeToEarn[] {
  return []
}

export function PlayBadgeGrids(_props: { orgslug: string; badges: TrailBadge[]; toEarn: BadgeToEarn[] }) {
  return null
}
