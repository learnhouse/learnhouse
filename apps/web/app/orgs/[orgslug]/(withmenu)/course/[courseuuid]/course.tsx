'use client'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import { getUriWithOrg, getAPIUrl } from '@services/config/config'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { swrFetcher } from '@services/utils/ts/requests'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import { useRouter } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import {
  getCourseThumbnailMediaDirectory,
} from '@services/media/media'
import { ArrowRight, Backpack, Check, File, StickyNote, Video, Square, Image as ImageIcon, Layers, BookCopy } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useMediaQuery } from 'usehooks-ts'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'
import CourseActionsMobile from '@components/Objects/Courses/CourseActions/CourseActionsMobile'
import CourseAuthors from '@components/Objects/Courses/CourseAuthors/CourseAuthors'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import CourseCommunitySection from '@components/Objects/Communities/CourseCommunitySection'
import CourseShare from '@components/Objects/Courses/CourseShare/CourseShare'
import { useAnalytics } from '@/hooks/useAnalytics'

const CourseClient = (props: any) => {
  const { t } = useTranslation()
  const [learnings, setLearnings] = useState<any>([])
  const [expandedChapters, setExpandedChapters] = useState<{[key: string]: boolean}>({})
  const [activeThumbnailType, setActiveThumbnailType] = useState<'image' | 'video'>('image')
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const initialCourse = props.course
  const serverError = props.serverError
  const org = useOrg() as any
  const router = useRouter()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  // Fetch course data client-side if server didn't provide it (e.g., auth failed on server)
  const { data: clientCourseData, error: courseError, isLoading: courseLoading } = useSWR(
    // Only fetch if we don't have initial course data AND we have a session token AND no server error
    !initialCourse && !serverError && access_token
      ? `${getAPIUrl()}courses/course_${courseuuid}/meta?slim=true`
      : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  );

  // Use server-provided course data, or client-fetched data as fallback
  const course = initialCourse || clientCourseData;

  const { track } = useAnalytics()

  // Track course view
  const courseId = course?.id
  const courseUuidForTracking = course?.course_uuid
  useEffect(() => {
    if (courseId && courseUuidForTracking) {
      track('course_view', {
        course_uuid: courseUuidForTracking,
      })
    }
  }, [courseId, courseUuidForTracking, track])

  // Add SWR for trail data
  const { data: trailData } = useSWR(
    `${getAPIUrl()}trail/org/${org?.id}/trail`,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  // Show loading state if fetching course data client-side
  if (!initialCourse && !serverError && courseLoading) {
    return <PageLoading />
  }

  // Determine the active error (server-side or client-side)
  const activeError = serverError || courseError

  // Show error if course fetch failed
  if (!course && activeError) {
    return (
      <GeneralWrapperStyled>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            {t('course.accessDenied', 'Unable to access this course')}
          </h2>
          <p className="text-gray-500 mb-4">
            {activeError?.status === 403
              ? t('course.noPermission', 'You do not have permission to view this course.')
              : t('course.loadError', 'This course could not be found or there was an error loading it.')}
          </p>
          <Link href={getUriWithOrg(orgslug, '/courses')} className="text-blue-600 hover:underline">
            {t('course.backToCourses', 'Back to Courses')}
          </Link>
        </div>
      </GeneralWrapperStyled>
    )
  }

  function getLearningTags(courseData: any) {
    if (!courseData?.learnings) {
      setLearnings([])
      return
    }

    try {
      // Try to parse as JSON (new format)
      const parsedLearnings = JSON.parse(courseData.learnings)
      if (Array.isArray(parsedLearnings)) {
        // New format: array of learning items with text and emoji
        setLearnings(parsedLearnings)
        return
      }
    } catch (e) {
      // Not valid JSON, continue to legacy format handling
    }

    // Legacy format: comma-separated string (changed from pipe-separated)
    const learningItems = courseData.learnings.split(',').map((text: string) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      text: text.trim(), // Trim whitespace that might be present after commas
      emoji: '📝' // Default emoji for legacy items
    }))

    setLearnings(learningItems)
  }

  useEffect(() => {
    if (!course) return

    getLearningTags(course)

    // Collapse chapters by default if more than 5 activities in total
    if (course?.chapters) {
      const totalActivities = course.chapters.reduce((sum: number, chapter: any) => sum + (chapter.activities?.length || 0), 0)
      const defaultExpanded: {[key: string]: boolean} = {}
      course.chapters.forEach((chapter: any, idx: number) => {
        // Always expand the first chapter
        defaultExpanded[chapter.chapter_uuid] = idx === 0 ? true : totalActivities <= 5
      })
      setExpandedChapters(defaultExpanded)
    }
  }, [course])

  const getActivityTypeLabel = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return t('activities.video')
      case 'TYPE_DOCUMENT':
        return t('activities.document')
      case 'TYPE_DYNAMIC':
        return t('activities.page')
      case 'TYPE_ASSIGNMENT':
        return t('activities.assignment')
      default:
        return t('activities.learning_material')
    }
  }

  const getActivityTypeBadgeColor = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return 'bg-neutral-100 text-neutral-500'
      case 'TYPE_DOCUMENT':
        return 'bg-neutral-100 text-neutral-500'
      case 'TYPE_DYNAMIC':
        return 'bg-neutral-100 text-neutral-500'
      case 'TYPE_ASSIGNMENT':
        return 'bg-neutral-100 text-neutral-500'
      default:
        return 'bg-neutral-100 text-neutral-500'
    }
  }

  const isActivityDone = (activity: any) => {
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');
    const run = trailData?.runs?.find(
      (run: any) => {
        const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
        return cleanRunCourseUuid === cleanCourseUuid;
      }
    );
    if (run) {
      return run.steps.find((step: any) => step.activity_id == activity.id)
    }
    return false
  }

  const isActivityCurrent = (activity: any) => {
    const activity_uuid = activity.activity_uuid.replace('activity_', '')
    if (props.current_activity && props.current_activity == activity_uuid) {
      return true
    }
    return false
  }

  // Generate JSON-LD structured data for SEO
  const generateJsonLd = () => {
    if (!course || !org) return null
    const seo = course.seo || {}

    // Check if JSON-LD is enabled (defaults to true if not set)
    if (seo.enable_jsonld === false) return null

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: seo.title || course.name,
      description: seo.description || course.description || '',
      provider: {
        '@type': 'Organization',
        name: org.name,
        ...(org.description && { description: org.description }),
      },
      ...(course.thumbnail_image && {
        image: getCourseThumbnailMediaDirectory(
          org?.org_uuid,
          course?.course_uuid,
          course?.thumbnail_image
        ),
      }),
      ...(course.creation_date && { dateCreated: course.creation_date }),
      ...(course.update_date && { dateModified: course.update_date }),
    }

    return jsonLd
  }

  const jsonLd = generateJsonLd()

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {!course && !org ? (
        <PageLoading></PageLoading>
      ) : (
        <>
          <GeneralWrapperStyled>
            <div className="pb-4">
              <Breadcrumbs items={[
                { label: t('courses.courses'), href: getUriWithOrg(orgslug, '/courses'), icon: <BookCopy size={14} /> },
                { label: course.name }
              ]} />
            </div>
            <div className="pb-2 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <h1 className="text-3xl md:text-3xl font-bold">{course.name}</h1>
              <CourseShare
                courseName={course.name}
                courseUrl={getUriWithOrg(orgslug, `/course/${courseuuid}`)}
              />
            </div>

            <div className="flex flex-col md:flex-row gap-8 pt-2">
              <div className="w-full md:w-3/4 space-y-4">
                {(() => {
                  const showVideo = course.thumbnail_type === 'video' || (course.thumbnail_type === 'both' && activeThumbnailType === 'video');
                  const showImage = course.thumbnail_type === 'image' || (course.thumbnail_type === 'both' && activeThumbnailType === 'image') || !course.thumbnail_type;

                  if (showVideo && course.thumbnail_video) {
                    return (
                      <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full h-[200px] md:h-[400px]">
                        {course.thumbnail_type === 'both' && (
                          <div className="absolute top-3 right-3 z-10">
                            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-1 flex space-x-1">
                              <button
                                onClick={() => setActiveThumbnailType('image')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'image'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <ImageIcon size={12} className="mr-1" />
                                {t('courses.image')}
                              </button>
                              <button
                                onClick={() => setActiveThumbnailType('video')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'video'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <Video size={12} className="mr-1" />
                                {t('activities.video')}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="w-full h-full">
                          <video
                            src={getCourseThumbnailMediaDirectory(
                              org?.org_uuid,
                              course?.course_uuid,
                              course?.thumbnail_video
                            )}
                            className="w-full h-full bg-black rounded-lg"
                            controls
                            autoPlay
                            muted
                            preload="metadata"
                            playsInline
                          />
                        </div>
                      </div>
                    );
                  } else if (showImage && course.thumbnail_image) {
                    return (
                      <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full h-[200px] md:h-[400px] bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                            org?.org_uuid,
                            course?.course_uuid,
                            course?.thumbnail_image
                          )})`,
                        }}
                      >
                        {course.thumbnail_type === 'both' && (
                          <div className="absolute top-3 right-3 z-10">
                            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-1 flex space-x-1">
                              <button
                                onClick={() => setActiveThumbnailType('image')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'image'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <ImageIcon size={12} className="mr-1" />
                                {t('courses.image')}
                              </button>
                              <button
                                onClick={() => setActiveThumbnailType('video')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'video'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <Video size={12} className="mr-1" />
                                {t('activities.video')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div
                        className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-full h-[400px] bg-cover bg-center"
                        style={{
                          backgroundImage: `url('/empty_thumbnail.png')`,
                          backgroundSize: 'auto',
                        }}
                      ></div>
                    );
                  }
                })()}

                {(() => {
                  const cleanCourseUuid = course.course_uuid?.replace('course_', '');
                  const run = trailData?.runs?.find(
                    (run: any) => {
                      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
                      return cleanRunCourseUuid === cleanCourseUuid;
                    }
                  );
                  return run;
                })() && (
                  <ActivityIndicators
                    course_uuid={props.course.course_uuid}
                    orgslug={orgslug}
                    course={course}
                    trailData={trailData}
                  />
                )}

                <div className="course_metadata_left space-y-2">
                  <div className="">
                    <p className="py-5 whitespace-pre-line break-words w-full leading-relaxed tracking-normal text-pretty hyphens-auto">{course.about}</p>
                  </div>
                </div>
              </div>

              <div className='course_metadata_right w-full md:w-1/4 space-y-4'>
                {/* Actions Box */}
                <CoursesActions courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />
                
                {/* Authors & Updates Box */}
                <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4">
                  <CourseProvider courseuuid={course.course_uuid}>
                    <CourseAuthors authors={course.authors} />
                  </CourseProvider>
                </div>
              </div>
            </div>

            {learnings.length > 0 && learnings[0]?.text !== 'null' && (
              <div className="w-full">
                <h2 className="py-5 text-xl md:text-2xl font-bold">{t('courses.what_you_will_learn')}</h2>
                <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden px-5 py-5 space-y-2">
                  {learnings.map((learning: any) => {
                    // Handle both new format (object with text and emoji) and legacy format (string)
                    const learningText = typeof learning === 'string' ? learning : learning.text
                    const learningEmoji = typeof learning === 'string' ? null : learning.emoji
                    const learningId = typeof learning === 'string' ? learning : learning.id || learning.text
                    
                    if (!learningText) return null
                    
                    return (
                      <div
                        key={learningId}
                        className="flex space-x-2 items-center font-semibold text-gray-500"
                      >
                        <div className="px-2 py-2 rounded-full">
                          {learningEmoji ? (
                            <span>{learningEmoji}</span>
                          ) : (
                            <Check className="text-gray-400" size={15} />
                          )}
                        </div>
                        <p>{learningText}</p>
                        {learning.link && (
                          <a 
                            href={learning.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline text-sm"
                          >
                            <span className="sr-only">Link to {learningText}</span>
                            <ArrowRight size={14} />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="w-full my-5 mb-10">
              <h2 className="py-5 text-xl md:text-2xl font-bold">{t('courses.course_lessons')}</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
                {(course.chapters ?? []).map((chapter: any, idx: number) => {
                  const isExpanded = expandedChapters[chapter.chapter_uuid] ?? (idx === 0); // Default to expanded for first chapter
                  return (
                    <div key={chapter.chapter_uuid || `chapter-${chapter.name}`} className="">
                      <div 
                        className="flex items-start py-4 px-4 outline outline-1 outline-neutral-200/40 font-bold bg-neutral-50 text-neutral-600 cursor-pointer hover:bg-neutral-100 transition-colors"
                        onClick={() => setExpandedChapters(prev => ({
                          ...prev,
                          [chapter.chapter_uuid]: !isExpanded
                        }))}
                      >
                        {/* Chevron on the far left, vertically centered with the title */}
                        <div className="flex flex-col justify-center mr-3 pt-1">
                          <svg 
                            className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                        {/* Title and badge column */}
                        <div className="flex flex-col items-start w-full">
                          <div className="flex items-center flex-wrap mb-1 w-full min-w-0">
                            {/* Numbered badge */}
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-neutral-200 text-neutral-600 text-xs font-semibold mr-2 border border-neutral-300 flex-shrink-0">
                              {idx + 1}
                            </span>
                            <h3 className="text-lg font-bold leading-tight truncate min-w-0 sm:text-base md:text-lg" style={{lineHeight: '1.2'}}>{chapter.name}</h3>
                          </div>
                          <div className="flex items-center space-x-1 text-sm text-neutral-400 font-normal">
                            <Layers size={16} className="mr-1" />
                            <span>{chapter.activities.length} {t('activities.activities')}</span>
                          </div>
                        </div>
                      </div>
                      <div className={`transition-all duration-200 ${isExpanded ? 'block' : 'hidden'}`}>
                        <div className="">
                          {chapter.activities.map((activity: any) => {
                            return (
                              <Link
                                key={activity.activity_uuid}
                                href={
                                  getUriWithOrg(orgslug, '') +
                                  `/course/${courseuuid}/activity/${activity.activity_uuid.replace('activity_', '')}`
                                }
                                rel="noopener noreferrer"
                                prefetch={false}
                                className="block group activity-container transition-all duration-200 px-4 py-4"
                              >
                                <div className="flex space-x-3 items-center">
                                  <div className="flex items-center">
                                    {isActivityDone(activity) ? (
                                      <div className="relative cursor-pointer">
                                        <Square size={16} className="stroke-[2] text-teal-600" />
                                        <Check size={16} className="stroke-[2.5] text-teal-600 absolute top-0 left-0" />
                                      </div>
                                    ) : (
                                      <div className="text-neutral-300 cursor-pointer">
                                        <Square size={16} className="stroke-[2]" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-col grow">
                                    <div className="flex items-center space-x-2 w-full">
                                      <p className="font-semibold text-neutral-600 group-hover:text-neutral-800 transition-colors">{activity.name}</p>
                                      {isActivityCurrent(activity) && (
                                        <div className="flex items-center space-x-1 text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full text-xs font-semibold animate-pulse">
                                          <span>{t('activities.current')}</span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center space-x-1.5 mt-0.5 text-neutral-400">
                                      {activity.activity_type === 'TYPE_DYNAMIC' && (
                                        <StickyNote size={10} />
                                      )}
                                      {activity.activity_type === 'TYPE_VIDEO' && (
                                        <Video size={10} />
                                      )}
                                      {activity.activity_type === 'TYPE_DOCUMENT' && (
                                        <File size={10} />
                                      )}
                                      {activity.activity_type === 'TYPE_ASSIGNMENT' && (
                                        <Backpack size={10} />
                                      )}
                                      <span className="text-xs font-medium">{getActivityTypeLabel(activity.activity_type)}</span>
                                    </div>
                                  </div>
                                  <div className="text-neutral-300 group-hover:text-neutral-400 transition-colors cursor-pointer">
                                    <ArrowRight size={14} />
                                  </div>
                                </div>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Community Section */}
            <CourseCommunitySection courseUuid={course.course_uuid} orgslug={orgslug} />
          </GeneralWrapperStyled>

          {/* Mobile Actions Box */}
          {isMobile && (
            <CourseActionsMobile courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />
          )}
        </>
      )}
    </>
  )
}

export default CourseClient