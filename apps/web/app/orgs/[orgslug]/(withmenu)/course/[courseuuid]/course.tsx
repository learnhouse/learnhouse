'use client'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import CourseActionsMobile from '@components/Objects/Courses/CourseActions/CourseActionsMobile'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'
import CourseUpdates from '@components/Objects/Courses/CourseUpdates/CourseUpdates'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import {
  ArrowRight,
  Backpack,
  Check,
  File,
  Sparkles,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useMediaQuery } from 'usehooks-ts'

const CourseClient = (props: any) => {
  const [learnings, setLearnings] = useState<any>([])
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const course = props.course
  const org = useOrg() as any
  const router = useRouter()
  const isMobile = useMediaQuery('(max-width: 768px)')

  console.log(course)

  function getLearningTags() {
    if (!course?.learnings) {
      setLearnings([])
      return
    }

    try {
      // Try to parse as JSON (new format)
      const parsedLearnings = JSON.parse(course.learnings)
      if (Array.isArray(parsedLearnings)) {
        // New format: array of learning items with text and emoji
        setLearnings(parsedLearnings)
        return
      }
    } catch (e) {
      // Not valid JSON, continue to legacy format handling
    }

    // Legacy format: comma-separated string (changed from pipe-separated)
    const learningItems = course.learnings.split(',').map((text: string) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      text: text.trim(), // Trim whitespace that might be present after commas
      emoji: '📝', // Default emoji for legacy items
    }))

    setLearnings(learningItems)
  }

  useEffect(() => {
    getLearningTags()
  }, [org, course])

  return (
    <>
      {!course && !org ? (
        <PageLoading></PageLoading>
      ) : (
        <>
          <GeneralWrapperStyled>
            <div className="flex flex-col items-start justify-between pb-3 md:flex-row md:items-center">
              <div>
                <p className="text-md pb-2 font-bold text-gray-400">Course</p>
                <h1 className="-mt-3 text-3xl font-bold md:text-3xl">
                  {course.name}
                </h1>
              </div>
              <div className="mt-4 md:mt-0">
                {!isMobile && (
                  <CourseProvider courseuuid={course.course_uuid}>
                    <CourseUpdates />
                  </CourseProvider>
                )}
              </div>
            </div>

            {props.course?.thumbnail_image && org ? (
              <div
                className="relative inset-0 mb-4 h-[200px] w-auto rounded-lg bg-cover bg-center shadow-xl ring-1 ring-black/10 ring-inset md:h-[400px]"
                style={{
                  backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                    org?.org_uuid,
                    course?.course_uuid,
                    course?.thumbnail_image
                  )})`,
                }}
              ></div>
            ) : (
              <div
                className="relative inset-0 mb-4 h-[400px] w-auto rounded-lg bg-cover bg-center shadow-xl ring-1 ring-black/10 ring-inset"
                style={{
                  backgroundImage: `url('../empty_thumbnail.png')`,
                  backgroundSize: 'auto',
                }}
              ></div>
            )}

            <ActivityIndicators
              course_uuid={props.course.course_uuid}
              orgslug={orgslug}
              course={course}
            />

            <div className="flex flex-col space-y-6 pt-10 md:flex-row md:space-y-0 md:space-x-10">
              <div className="course_metadata_left w-full space-y-2 md:basis-3/4">
                <h2 className="py-3 text-2xl font-bold">About</h2>
                <div className="overflow-hidden rounded-lg bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40">
                  <p className="px-5 py-5 whitespace-pre-wrap">
                    {course.about}
                  </p>
                </div>

                {learnings.length > 0 && learnings[0]?.text !== 'null' && (
                  <div>
                    <h2 className="py-3 text-2xl font-bold">
                      What you will learn
                    </h2>
                    <div className="space-y-2 overflow-hidden rounded-lg bg-white px-5 py-5 shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40">
                      {learnings.map((learning: any) => {
                        // Handle both new format (object with text and emoji) and legacy format (string)
                        const learningText =
                          typeof learning === 'string'
                            ? learning
                            : learning.text
                        const learningEmoji =
                          typeof learning === 'string' ? null : learning.emoji
                        const learningId =
                          typeof learning === 'string'
                            ? learning
                            : learning.id || learning.text

                        if (!learningText) return null

                        return (
                          <div
                            key={learningId}
                            className="flex items-center space-x-2 font-semibold text-gray-500"
                          >
                            <div className="rounded-full px-2 py-2">
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
                                className="text-sm text-blue-500 hover:underline"
                              >
                                <span className="sr-only">
                                  Link to {learningText}
                                </span>
                                <ArrowRight size={14} />
                              </a>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <h2 className="py-3 text-xl font-bold md:text-2xl">
                  Course Lessons
                </h2>
                <div className="overflow-hidden rounded-lg bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40">
                  {course.chapters.map((chapter: any) => {
                    return (
                      <div
                        key={chapter.chapter_uuid || `chapter-${chapter.name}`}
                        className=""
                      >
                        <div className="flex items-center bg-neutral-50 px-4 py-4 text-lg font-bold text-neutral-600 outline outline-1 outline-neutral-200/40">
                          <h3 className="mr-3 grow break-words">
                            {chapter.name}
                          </h3>
                          <p className="shrink-0 rounded-full px-3 py-[2px] text-sm font-normal whitespace-nowrap text-neutral-400 outline outline-1 outline-neutral-200">
                            {chapter.activities.length} Activities
                          </p>
                        </div>
                        <div className="py-3">
                          {chapter.activities.map((activity: any) => {
                            return (
                              <div
                                key={activity.activity_uuid}
                                className="activity-container"
                              >
                                <p className="text-md flex"></p>
                                <div className="flex items-center space-x-1 px-4 py-2">
                                  <div className="courseicon flex items-center space-x-2 text-neutral-400">
                                    {activity.activity_type ===
                                      'TYPE_DYNAMIC' && (
                                      <div className="rounded-full bg-gray-100 px-2 py-2">
                                        <Sparkles
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                    {activity.activity_type ===
                                      'TYPE_VIDEO' && (
                                      <div className="rounded-full bg-gray-100 px-2 py-2">
                                        <Video
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                    {activity.activity_type ===
                                      'TYPE_DOCUMENT' && (
                                      <div className="rounded-full bg-gray-100 px-2 py-2">
                                        <File
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                    {activity.activity_type ===
                                      'TYPE_ASSIGNMENT' && (
                                      <div className="rounded-full bg-gray-100 px-2 py-2">
                                        <Backpack
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <Link
                                    className="flex grow pl-2 font-semibold text-neutral-500"
                                    href={
                                      getUriWithOrg(orgslug, '') +
                                      `/course/${courseuuid}/activity/${activity.activity_uuid.replace(
                                        'activity_',
                                        ''
                                      )}`
                                    }
                                    rel="noopener noreferrer"
                                    prefetch={false}
                                  >
                                    <p>{activity.name}</p>
                                  </Link>
                                  <div className="flex">
                                    {activity.activity_type ===
                                      'TYPE_DYNAMIC' && (
                                      <div>
                                        <Link
                                          className="flex grow pl-2 text-gray-500"
                                          href={
                                            getUriWithOrg(orgslug, '') +
                                            `/course/${courseuuid}/activity/${activity.activity_uuid.replace(
                                              'activity_',
                                              ''
                                            )}`
                                          }
                                          rel="noopener noreferrer"
                                          prefetch={false}
                                        >
                                          <div className="flex items-center space-x-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-400">
                                            <p>Page</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </div>
                                    )}
                                    {activity.activity_type ===
                                      'TYPE_VIDEO' && (
                                      <div>
                                        <Link
                                          className="flex grow pl-2 text-gray-500"
                                          href={
                                            getUriWithOrg(orgslug, '') +
                                            `/course/${courseuuid}/activity/${activity.activity_uuid.replace(
                                              'activity_',
                                              ''
                                            )}`
                                          }
                                          rel="noopener noreferrer"
                                          prefetch={false}
                                        >
                                          <div className="flex items-center space-x-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-400">
                                            <p>Video</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </div>
                                    )}
                                    {activity.activity_type ===
                                      'TYPE_DOCUMENT' && (
                                      <div>
                                        <Link
                                          className="flex grow pl-2 text-gray-500"
                                          href={
                                            getUriWithOrg(orgslug, '') +
                                            `/course/${courseuuid}/activity/${activity.activity_uuid.replace(
                                              'activity_',
                                              ''
                                            )}`
                                          }
                                          rel="noopener noreferrer"
                                          prefetch={false}
                                        >
                                          <div className="flex items-center space-x-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-400">
                                            <p>Document</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </div>
                                    )}
                                    {activity.activity_type ===
                                      'TYPE_ASSIGNMENT' && (
                                      <div>
                                        <Link
                                          className="flex grow pl-2 text-gray-500"
                                          href={
                                            getUriWithOrg(orgslug, '') +
                                            `/course/${courseuuid}/activity/${activity.activity_uuid.replace(
                                              'activity_',
                                              ''
                                            )}`
                                          }
                                          rel="noopener noreferrer"
                                          prefetch={false}
                                        >
                                          <div className="flex items-center space-x-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-400">
                                            <p>Assignment</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="course_metadata_right basis-1/4">
                <CoursesActions
                  courseuuid={courseuuid}
                  orgslug={orgslug}
                  course={course}
                />
              </div>
            </div>
          </GeneralWrapperStyled>

          {isMobile && (
            <div className="fixed right-0 bottom-0 left-0 z-50 p-4">
              <CourseActionsMobile
                courseuuid={courseuuid}
                orgslug={orgslug}
                course={course}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}

export default CourseClient
