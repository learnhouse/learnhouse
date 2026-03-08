'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import TrailCourseCard from '@components/Pages/Trail/TrailCourseCard'
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
import { BookOpen, Signpost } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'

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

  // Check if courses feature is enabled
  const isCoursesEnabled = org?.config?.config?.resolved_features?.courses?.enabled ?? org?.config?.config?.features?.courses?.enabled !== false

  // Only fetch trail data if courses feature is enabled
  const { data: trail, error: error, mutate } = useSWR(
    isCoursesEnabled && orgID ? `${getAPIUrl()}trail/org/${orgID}/trail` : null,
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
    <FeatureDisabledView
      featureName="courses"
      orgslug={orgslug}
      icon={Signpost}
      context="public"
    >
    <GeneralWrapperStyled>
      <div className="flex flex-col space-y-2 mb-6">
        <div className="flex items-center justify-between">
          <TypeOfContentTitle title={t('courses.progress')} type="tra" />
          {trail?.runs?.length > 0 && (
            <ConfirmationModal
              confirmationButtonText={isQuittingAll ? t('courses.quitting_courses', { progress: quittingProgress }) : t('courses.quit_all_courses')}
              confirmationMessage={t('courses.quit_all_courses_confirm')}
              dialogTitle={t('courses.quit_all_courses_title')}
              dialogTrigger={
                <button
                  disabled={isQuittingAll}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors
                    ${isQuittingAll
                      ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                      : 'bg-red-50 text-red-700 hover:bg-red-100'
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

        {!trail ? (
          <PageLoading></PageLoading>
        ) : trail.runs.length === 0 ? (
          <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
            <div className="p-4 bg-white rounded-full nice-shadow mb-4">
              <BookOpen className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
            </div>
            <h1 className="text-xl font-bold text-gray-600 mb-2">
              {t('user.no_courses_in_progress')}
            </h1>
            <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
              {t('user.start_course_to_see_progress')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {trail.runs.map((run: any) => (
              <TrailCourseCard
                key={run.course.course_uuid}
                run={run}
                course={run.course}
                orgslug={orgslug}
              />
            ))}
          </div>
        )}
      </div>

      <UserCertificates orgslug={orgslug} />
    </GeneralWrapperStyled>
    </FeatureDisabledView>
  )
}

export default Trail
