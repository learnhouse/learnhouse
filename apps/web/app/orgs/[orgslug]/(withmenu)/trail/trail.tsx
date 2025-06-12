'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import TrailCourseElement from '@components/Pages/Trail/TrailCourseElement'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { useEffect, useState } from 'react'
import useSWR from 'swr'
import { removeCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'

function Trail(params: any) {
  let orgslug = params.orgslug
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const org = useOrg() as any
  const orgID = org?.id
  const router = useRouter()
  const [isQuittingAll, setIsQuittingAll] = useState(false)
  const [quittingProgress, setQuittingProgress] = useState(0)

  const { data: trail, error: error, mutate } = useSWR(
    `${getAPIUrl()}trail/org/${orgID}/trail`,
    (url) => swrFetcher(url, access_token)
  )

  const handleQuitAllCourses = async () => {
    if (!trail?.runs?.length || isQuittingAll) return;
    
    setIsQuittingAll(true)
    const totalCourses = trail.runs.length;

    try {
      for (let i = 0; i < trail.runs.length; i++) {
        const run = trail.runs[i];
        await removeCourse(run.course.course_uuid, orgslug, access_token);
        setQuittingProgress(Math.round(((i + 1) / totalCourses) * 100));
      }

      await revalidateTags(['courses'], orgslug);
      router.refresh();
      await mutate();
    } catch (error) {
      console.error('Error quitting courses:', error);
    } finally {
      setIsQuittingAll(false)
      setQuittingProgress(0)
    }
  }

  useEffect(() => { }, [trail, org])

  return (
    <GeneralWrapperStyled>
      <div className="flex justify-between items-center mb-6">
        <TypeOfContentTitle title="Trail" type="tra" />
        {trail?.runs?.length > 0 && (
          <button
            onClick={handleQuitAllCourses}
            disabled={isQuittingAll}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all
              ${isQuittingAll 
                ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                : 'bg-red-100 text-red-700 hover:bg-red-200'
              }`}
          >
            {isQuittingAll 
              ? `Quitting Courses (${quittingProgress}%)`
              : 'Quit All Courses'
            }
          </button>
        )}
      </div>
      {!trail ? (
        <PageLoading></PageLoading>
      ) : (
        <div className="space-y-6">
          {trail.runs.map((run: any) => (
            <TrailCourseElement
              key={run.course.course_uuid}
              run={run}
              course={run.course}
              orgslug={orgslug}
            />
          ))}
        </div>
      )}
    </GeneralWrapperStyled>
  )
}

export default Trail
