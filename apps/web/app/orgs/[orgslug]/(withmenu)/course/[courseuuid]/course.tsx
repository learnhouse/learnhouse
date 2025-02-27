'use client'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import { getUriWithOrg } from '@services/config/config'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { revalidateTags } from '@services/utils/ts/requests'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import { useRouter } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import {
  getCourseThumbnailMediaDirectory,
  getUserAvatarMediaDirectory,
} from '@services/media/media'
import { ArrowRight, Backpack, Check, File, Sparkles, Video } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import UserAvatar from '@components/Objects/UserAvatar'
import CourseUpdates from '@components/Objects/Courses/CourseUpdates/CourseUpdates'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useMediaQuery } from 'usehooks-ts'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'

const CourseClient = (props: any) => {
  const [learnings, setLearnings] = useState<any>([])
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const course = props.course
  const org = useOrg() as any
  const router = useRouter()
  const isMobile = useMediaQuery('(max-width: 768px)')

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
      emoji: '📝' // Default emoji for legacy items
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
        <GeneralWrapperStyled>
          <div className="pb-3 flex flex-col md:flex-row justify-between items-start md:items-center">
            <div>
              <p className="text-md font-bold text-gray-400 pb-2">Course</p>
              <h1 className="text-3xl md:text-3xl -mt-3 font-bold">{course.name}</h1>
            </div>
            <div className="mt-4 md:mt-0">
              {!isMobile && <CourseProvider courseuuid={course.course_uuid}>
                <CourseUpdates />
              </CourseProvider>}
            </div>
          </div>

          {props.course?.thumbnail_image && org ? (
            <div
              className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-auto h-[200px] md:h-[400px] bg-cover bg-center mb-4"
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
              className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-auto h-[400px] bg-cover bg-center mb-4"
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

          <div className="flex flex-col md:flex-row md:space-x-10 space-y-6 md:space-y-0 pt-10">
            <div className="course_metadata_left w-full md:basis-3/4 space-y-2">
              <h2 className="py-3 text-2xl font-bold">About</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
                <p className="py-5 px-5 whitespace-pre-wrap">{course.about}</p>
              </div>

              {learnings.length > 0 && learnings[0]?.text !== 'null' && (
                <div>
                  <h2 className="py-3 text-2xl font-bold">
                    What you will learn
                  </h2>
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

              <h2 className="py-3 text-xl md:text-2xl font-bold">Course Lessons</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
                {course.chapters.map((chapter: any) => {
                  return (
                    <div key={chapter} className="">
                      <div className="flex text-lg py-4 px-4 outline outline-1 outline-neutral-200/40 font-bold bg-neutral-50 text-neutral-600 items-center">
                        <h3 className="grow mr-3 break-words">{chapter.name}</h3>
                        <p className="text-sm font-normal text-neutral-400 px-3 py-[2px] outline-1 outline outline-neutral-200 rounded-full whitespace-nowrap flex-shrink-0">
                          {chapter.activities.length} Activities
                        </p>
                      </div>
                      <div className="py-3">
                        {chapter.activities.map((activity: any) => {
                          return (
                            <>
                              <p className="flex text-md"></p>
                              <div className="flex space-x-1 py-2 px-4 items-center">
                                <div className="courseicon items-center flex space-x-2 text-neutral-400">
                                  {activity.activity_type ===
                                    'TYPE_DYNAMIC' && (
                                      <div className="bg-gray-100 px-2 py-2 rounded-full">
                                        <Sparkles
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                  {activity.activity_type === 'TYPE_VIDEO' && (
                                    <div className="bg-gray-100 px-2 py-2 rounded-full">
                                      <Video
                                        className="text-gray-400"
                                        size={13}
                                      />
                                    </div>
                                  )}
                                  {activity.activity_type ===
                                    'TYPE_DOCUMENT' && (
                                      <div className="bg-gray-100 px-2 py-2 rounded-full">
                                        <File
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                  {activity.activity_type ===
                                    'TYPE_ASSIGNMENT' && (
                                      <div className="bg-gray-100 px-2 py-2 rounded-full">
                                        <Backpack
                                          className="text-gray-400"
                                          size={13}
                                        />
                                      </div>
                                    )}
                                </div>
                                <Link
                                  className="flex font-semibold grow pl-2 text-neutral-500"
                                  href={
                                    getUriWithOrg(orgslug, '') +
                                    `/course/${courseuuid}/activity/${activity.activity_uuid.replace(
                                      'activity_',
                                      ''
                                    )}`
                                  }
                                  rel="noopener noreferrer"
                                >
                                  <p>{activity.name}</p>
                                </Link>
                                <div className="flex ">
                                  {activity.activity_type ===
                                    'TYPE_DYNAMIC' && (
                                      <>
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
                                        >
                                          <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                            <p>Page</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </>
                                    )}
                                  {activity.activity_type === 'TYPE_VIDEO' && (
                                    <>
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
                                      >
                                        <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                          <p>Video</p>
                                          <ArrowRight size={13} />
                                        </div>
                                      </Link>
                                    </>
                                  )}
                                  {activity.activity_type ===
                                    'TYPE_DOCUMENT' && (
                                      <>
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
                                        >
                                          <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                            <p>Document</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </>
                                    )}
                                  {activity.activity_type ===
                                    'TYPE_ASSIGNMENT' && (
                                      <>
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
                                        >
                                          <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                            <p>Assignment</p>
                                            <ArrowRight size={13} />
                                          </div>
                                        </Link>
                                      </>
                                    )}
                                </div>
                              </div>
                            </>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className='course_metadata_right basis-1/4'>
              <CoursesActions courseuuid={courseuuid} orgslug={orgslug} course={course} />
            </div>
          </div>
        </GeneralWrapperStyled>
      )}
    </>
  )
}

export default CourseClient
