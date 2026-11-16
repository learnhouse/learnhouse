// OSS stub: Play badges require Enterprise Edition. Nobody has any, so the
// profile and the dashboard drawer show no badge section.

export function useUserBadges(_userId: number | undefined, _accessToken: string | undefined, _orgId?: number | null) {
  return { data: [] as any[], isLoading: false }
}

export function UserBadgesGrid(_props: { badges: any[] }) {
  return null
}

export function UserBadgesSkeleton(_props: { count?: number }) {
  return null
}

export function UserBadgesRow(_props: {
  userId: number | undefined
  accessToken: string | undefined
  orgId?: number | null
  className?: string
}) {
  return null
}

export function UserBadgesStrip(_props: { badges: any[]; max?: number }) {
  return null
}
