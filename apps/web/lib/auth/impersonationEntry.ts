// When an org page should start (or switch) an impersonation on its own.
// Platform staff opening an org they don't belong to go straight in as its
// owner; staff already impersonating in another org switch to this one.

export const ENTRY_EXEMPT =
  /^\/(login|signup|reset|forgot|verify-email|auth|home|new|redirect_from_auth|embed|oauth|payments|backoffice|admin)(\/|$)/

export type EntryPlace = { slug: string | null; path: string; platform: boolean }

export type EntrySession = {
  status?: string
  data?: {
    user?: { is_backoffice_staff?: boolean } | null
    roles?: unknown
    impersonation?: { scope?: string | null; org?: { slug?: string | null } | null } | null
  } | null
}

/** "enter": start as this org's owner. "switch": leave the other org's
 *  impersonation for this one. null: nothing to do. */
export function autoEntryMode(session: EntrySession | null | undefined, where: EntryPlace | null): 'enter' | 'switch' | null {
  if (session?.status !== 'authenticated' || !where || where.platform || !where.slug || ENTRY_EXEMPT.test(where.path)) {
    return null
  }
  const data = session.data
  const impersonatedSlug = data?.impersonation?.org?.slug ?? null
  if (data?.impersonation) {
    // An org admin's "view as" never follows them into another org.
    if (data.impersonation.scope === 'org') return null
    return impersonatedSlug && impersonatedSlug !== where.slug ? 'switch' : null
  }
  const roles: any[] = Array.isArray(data?.roles) ? (data!.roles as any[]) : []
  if (data?.user?.is_backoffice_staff === true && !roles.some((r) => r?.org?.slug === where.slug)) return 'enter'
  return null
}
