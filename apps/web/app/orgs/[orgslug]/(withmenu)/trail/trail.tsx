'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TrailCourseElement from '@components/Pages/Trail/TrailCourseElement'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useEffect } from 'react'
import useSWR from 'swr'

function Trail(params: any) {
  const orgslug = params.orgslug
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const orgID = org?.id
  const { data: trail, error } = useSWR(
    `${getAPIUrl()}trail/org/${orgID}/trail`,
    (url) => swrFetcher(url, access_token)
  )

  useEffect(() => {}, [trail, org])

  return (
    <GeneralWrapperStyled>
      <TypeOfContentTitle title="Trail" type="tra" />
      {!trail ? (
        <PageLoading></PageLoading>
      ) : (
        <div className="space-y-6">
          {trail.runs.map((run: any) => (
            <>
              <TrailCourseElement
                run={run}
                course={run.course}
                orgslug={orgslug}
              />
            </>
          ))}
        </div>
      )}
    </GeneralWrapperStyled>
  )
}

export default Trail
