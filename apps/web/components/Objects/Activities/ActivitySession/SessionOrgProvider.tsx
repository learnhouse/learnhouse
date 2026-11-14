'use client'

// The lesson components read the org from OrgContext (media URLs, plan
// checks). Hosts outside the org layout (the board route) have none, so the
// session provides one from the org it already loaded. Unlike OrgProvider it
// never swaps the page for a full-screen error: a session is a small part of
// someone else's screen.

import React, { useContext, useMemo } from 'react'
import { OrgContext } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useSessionOrg, useSessionToken } from './useActivitySession'

export default function SessionOrgProvider({ orgslug, children }: { orgslug: string; children: React.ReactNode }) {
  const outer = useContext(OrgContext)
  const session = useLHSession() as any
  const token = useSessionToken()
  const org = useSessionOrg(orgslug, token)

  const roles = session?.data?.roles
  const superadmin = !!session?.data?.user?.is_superadmin
  const value = useMemo(() => {
    const member =
      !org?.id || superadmin || (Array.isArray(roles) && roles.some((r: any) => r?.org?.id === org.id))
    return { org, isUserPartOfTheOrg: member, orgslug }
  }, [org, roles, superadmin, orgslug])

  if (outer?.org) return <>{children}</>
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}
