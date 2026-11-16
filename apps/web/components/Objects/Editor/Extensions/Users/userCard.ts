/*
 Pure helpers for the User card block (no React), unit tested in
 tests/editor-blocks-embeds.test.mjs.
*/

export type UserCardLayout = 'card' | 'compact'

/** Old blocks have no layout attr and keep the full card they always had. */
export function userCardLayoutOf(value: unknown): UserCardLayout {
  return value === 'compact' ? 'compact' : 'card'
}

/**
 * The stored id is whatever the block was given: a number from the picker,
 * a numeric string from older content, or '' / null when nothing is chosen.
 * Anything that isn't a positive integer means "no member yet".
 */
export function userIdOf(value: unknown): string | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? String(value) : null
  if (typeof value === 'string' && /^\d+$/.test(value.trim()) && Number(value) > 0) return value.trim()
  return null
}

export function displayName(user: { first_name?: string | null; last_name?: string | null; username?: string | null } | null | undefined): string {
  if (!user) return ''
  return [user.first_name, user.last_name].filter((s) => typeof s === 'string' && s.trim()).join(' ').trim() || user.username || ''
}

/** Rows from GET /orgs/{id}/users, reduced to what the picker shows. */
export interface MemberOption {
  id: number
  user_uuid: string
  username: string
  name: string
  avatar_image: string
  role: string
}

export function memberOptionsFrom(payload: unknown): MemberOption[] {
  const items = payload && typeof payload === 'object' && Array.isArray((payload as any).items) ? (payload as any).items : []
  const out: MemberOption[] = []
  for (const row of items) {
    const u = row?.user
    if (!u || typeof u.id !== 'number') continue
    out.push({
      id: u.id,
      user_uuid: String(u.user_uuid || ''),
      username: String(u.username || ''),
      name: displayName(u),
      avatar_image: String(u.avatar_image || ''),
      role: typeof row?.role?.name === 'string' ? row.role.name : '',
    })
  }
  return out
}
