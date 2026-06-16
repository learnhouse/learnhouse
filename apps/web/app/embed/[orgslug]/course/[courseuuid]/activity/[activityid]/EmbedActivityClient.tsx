'use client'

import { useSearchParams } from 'next/navigation'
import {
  LearnHouseReaderProvider,
  LearnHouseActivity,
} from '@learnhouse/reader-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  getAPIUrl,
  getLEARNHOUSE_DOMAIN_VAL,
  getLEARNHOUSE_HTTP_PROTOCOL_VAL,
} from '@services/config/config'

interface EmbedActivityClientProps {
  activityId: string
  courseuuid: string
  orgslug: string
  bgcolor: string | null
}

export default function EmbedActivityClient({
  activityId,
  courseuuid,
  orgslug,
  bgcolor,
}: EmbedActivityClientProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const searchParams = useSearchParams()
  const showLogo = searchParams.get('showlearnhouselogo') !== 'false'
  const textcolor = searchParams.get('textcolor')

  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const baseApiUrl = getAPIUrl()
  const orgUuid: string | undefined = org?.org_uuid

  const buildActivityUrl = ({
    courseUuid,
    activityId,
  }: {
    orgSlug: string
    courseUuid: string
    activityId: string
  }) => {
    const path = `/course/${courseUuid}/activity/${activityId}`
    const domain = getLEARNHOUSE_DOMAIN_VAL()
    const protocol = getLEARNHOUSE_HTTP_PROTOCOL_VAL()
    if (typeof window !== 'undefined' && orgslug && domain && domain !== 'localhost') {
      return `${protocol}${orgslug}.${domain}${path}`
    }
    return path
  }

  return (
    <LearnHouseReaderProvider
      baseApiUrl={baseApiUrl}
      orgSlug={orgslug}
      orgUuid={orgUuid}
      accessToken={accessToken}
      showPoweredBy={showLogo}
      buildActivityUrl={buildActivityUrl}
    >
      <LearnHouseActivity
        activityId={activityId}
        courseUuid={courseuuid}
        bgcolor={bgcolor ?? undefined}
        textcolor={textcolor ?? undefined}
      />
    </LearnHouseReaderProvider>
  )
}
