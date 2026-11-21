'use client'

import { useParams } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'

/** Token, org and user for the notification calls; all optional (signed out → nulls). */
export function useNotificationSession() {
  const session = useLHSession() as any
  const org = useOrg() as any
  const params = useParams() as any
  const currentOrgId = (org?.id as number | undefined) ?? undefined
  // The API answers 403 for an org the user doesn't belong to (a visitor on
  // another school's site; backoffice staff pass). Use the all-orgs scope there.
  const roles: any[] = Array.isArray(session?.data?.roles) ? session.data.roles : []
  const isMember =
    currentOrgId !== undefined &&
    (session?.data?.user?.is_backoffice_staff === true || roles.some((r: any) => r?.org?.id === currentOrgId))
  return {
    token: (session?.data?.tokens?.access_token as string | undefined) || null,
    userId: (session?.data?.user?.id as number | undefined) ?? null,
    orgId: isMember ? currentOrgId : undefined,
    orgslug: (org?.slug as string | undefined) || (params?.orgslug as string | undefined) || '',
    signedIn: session?.status === 'authenticated' || Boolean(session?.data?.user?.id),
  }
}
