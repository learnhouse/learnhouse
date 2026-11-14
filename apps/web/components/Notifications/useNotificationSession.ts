'use client'

import { useParams } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'

/** Token, org and user for the notification calls; all optional (signed out → nulls). */
export function useNotificationSession() {
  const session = useLHSession() as any
  const org = useOrg() as any
  const params = useParams() as any
  return {
    token: (session?.data?.tokens?.access_token as string | undefined) || null,
    userId: (session?.data?.user?.id as number | undefined) ?? null,
    orgId: (org?.id as number | undefined) ?? undefined,
    orgslug: (org?.slug as string | undefined) || (params?.orgslug as string | undefined) || '',
    signedIn: session?.status === 'authenticated' || Boolean(session?.data?.user?.id),
  }
}
