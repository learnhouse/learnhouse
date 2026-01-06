'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import TrailCourseElement from '@components/Pages/Trail/TrailCourseElement'
import UserCertificates from '@components/Pages/Trail/UserCertificates'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { useEffect, useState } from 'react'
import useSWR from 'swr'
import { removeCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function Trail(params: any) {
  const { t } = useTranslation()
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
        <TypeOfContentTitle title={t('courses.progress')} type="tra" />
        {trail?.runs?.length > 0 && (
          <ConfirmationModal
            confirmationButtonText={isQuittingAll ? t('courses.quitting_courses', { progress: quittingProgress }) : t('courses.quit_all_courses')}
            confirmationMessage={t('courses.quit_all_courses_confirm')}
            dialogTitle={t('courses.quit_all_courses_title')}
            dialogTrigger={
              <button
                disabled={isQuittingAll}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all
                  ${isQuittingAll 
                    ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                  }`}
              >
                {isQuittingAll 
                  ? t('courses.quitting_courses', { progress: quittingProgress })
                  : t('courses.quit_all_courses')
                }
              </button>
            }
            functionToExecute={handleQuitAllCourses}
            status="warning"
          />
        )}
      </div>
      
      <div className="space-y-8">
        {/* Progress Section */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-6">
            <BookOpen className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold text-gray-900">{t('user.my_progress')}</h2>
            {trail?.runs && (
              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {trail.runs.length}
              </span>
            )}
          </div>
          
          {!trail ? (
            <PageLoading></PageLoading>
          ) : trail.runs.length === 0 ? (
            <div className="text-center py-8">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">{t('user.no_courses_in_progress')}</p>
              <p className="text-sm text-gray-400 mt-1">{t('user.start_course_to_see_progress')}</p>
            </div>
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
        </div>
        
        {/* Certificates Section */}
        <UserCertificates orgslug={orgslug} />
      </div>
    </GeneralWrapperStyled>
  )
}

export default Trail
