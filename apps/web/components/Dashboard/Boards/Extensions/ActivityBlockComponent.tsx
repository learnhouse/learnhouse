'use client'

import React, { Suspense, lazy, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronRight, ArrowLeft, ExternalLink } from 'lucide-react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'
import { getOrgCourses } from '@services/courses/courses'
import { getCourseMetadata } from '@services/courses/courses'
import { getActivity } from '@services/courses/activities'
import { getUriWithOrg } from '@services/config/config'
import { CourseContext, CourseDispatchContext } from '@components/Contexts/CourseContext'

const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))

const EMBEDDABLE_TYPES = ['TYPE_DYNAMIC', 'TYPE_VIDEO', 'TYPE_DOCUMENT']

function EmbedCourseProvider({ children }: { children: React.ReactNode }) {
  const minimalState = {
    courseStructure: null,
    courseOrder: null,
    pendingChanges: {},
    isSaved: true,
    isLoading: false,
    isSaving: false,
    saveError: null,
    withUnpublishedActivities: false,
    lastSyncedAt: null,
  }

  return (
    <CourseContext.Provider value={minimalState}>
      <CourseDispatchContext.Provider value={() => {}}>
        {children}
      </CourseDispatchContext.Provider>
    </CourseContext.Provider>
  )
}

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-32">
    <div className="relative w-5 h-5">
      <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-100 rounded-full"></div>
      <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent"></div>
    </div>
  </div>
)

export default function ActivityBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { t } = useTranslation()
  const { activityUuid, courseUuid, x, y, width, height } = node.attrs

  // Picker state
  const [courses, setCourses] = useState<any[]>([])
  const [selectedCourse, setSelectedCourse] = useState<any>(null)
  const [courseMetadata, setCourseMetadata] = useState<any>(null)
  const [loadingCourses, setLoadingCourses] = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Activity render state
  const [activity, setActivity] = useState<any>(null)
  const [courseMeta, setCourseMeta] = useState<any>(null)
  const [loadingActivity, setLoadingActivity] = useState(false)

  const accessToken = editor?.storage?.boardContext?.accessToken || ''
  const orgslug = editor?.storage?.boardContext?.orgslug || ''

  // Fetch courses for picker
  useEffect(() => {
    if (activityUuid || !orgslug || !accessToken) return
    setLoadingCourses(true)
    getOrgCourses(orgslug, null, accessToken, true)
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || res?.courses || []
        setCourses(list)
      })
      .catch((err: any) => {
        console.error('ActivityBlock: failed to fetch courses', err)
        setCourses([])
      })
      .finally(() => setLoadingCourses(false))
  }, [activityUuid, orgslug, accessToken])

  // Fetch course metadata when a course is selected in picker
  useEffect(() => {
    if (!selectedCourse) return
    const uuid = selectedCourse.course_uuid?.replace('course_', '') || selectedCourse.course_uuid
    setLoadingMeta(true)
    getCourseMetadata(uuid, null, accessToken)
      .then((res: any) => setCourseMetadata(res))
      .catch(() => setCourseMetadata(null))
      .finally(() => setLoadingMeta(false))
  }, [selectedCourse, accessToken])

  // Fetch activity data when activityUuid is set
  useEffect(() => {
    if (!activityUuid) return
    setLoadingActivity(true)
    const fetchData = async () => {
      try {
        const [actData, cMeta] = await Promise.all([
          getActivity(activityUuid, null, accessToken),
          courseUuid
            ? getCourseMetadata(courseUuid.replace('course_', ''), null, accessToken)
            : Promise.resolve(null),
        ])
        setActivity(actData)
        setCourseMeta(cMeta)
      } catch {
        setActivity(null)
      } finally {
        setLoadingActivity(false)
      }
    }
    fetchData()
  }, [activityUuid, courseUuid, accessToken])

  // --- Drag & Resize (smooth, commit on mouseUp only) ---
  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 320, minHeight: 240,
    updateAttributes,
    editor,
    getPos,
  })

  // --- Select activity ---
  const handleSelectActivity = (act: any) => {
    const actUuid = act.activity_uuid || ''
    const cUuid = selectedCourse?.course_uuid || ''
    updateAttributes({ activityUuid: actUuid, courseUuid: cUuid })
  }

  // --- No activity set: show picker ---
  if (!activityUuid) {
    return (
      <BoardBlockWrapper
        selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
        x={x} y={y} width={width} stopWheel
        style={{ minHeight: 200 }}
      >
        <DragHandle onMouseDown={handleDragStart} className="bg-gray-50/80 border-b border-gray-100 rounded-t-xl" />

        {!selectedCourse ? (
          // Step 1: Course list
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                <BookOpen size={14} className="text-blue-500" />
              </div>
              <p className="text-xs font-medium text-neutral-600">{t('boards.activity_block.select_course')}</p>
            </div>
            {loadingCourses ? (
              <LoadingFallback />
            ) : courses.length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-4">{t('boards.activity_block.no_courses')}</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
                {courses.map((course: any) => (
                  <button
                    key={course.course_uuid}
                    onClick={() => setSelectedCourse(course)}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-neutral-50 transition-colors text-left group/item"
                  >
                    <span className="text-xs font-medium text-neutral-700 truncate">
                      {course.name}
                    </span>
                    <ChevronRight size={12} className="text-neutral-300 group-hover/item:text-neutral-500" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Step 2: Activity list grouped by chapter
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSelectedCourse(null); setCourseMetadata(null) }}
                className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center hover:bg-neutral-200 transition-colors"
              >
                <ArrowLeft size={10} className="text-neutral-500" />
              </button>
              <p className="text-xs font-medium text-neutral-600 truncate">{selectedCourse.name}</p>
            </div>
            {loadingMeta ? (
              <LoadingFallback />
            ) : !courseMetadata?.chapters ? (
              <p className="text-xs text-neutral-400 text-center py-4">{t('boards.activity_block.no_activities')}</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto">
                {courseMetadata.chapters.map((chapter: any) => {
                  const embeddable = (chapter.activities || []).filter(
                    (a: any) => EMBEDDABLE_TYPES.includes(a.activity_type)
                  )
                  if (embeddable.length === 0) return null
                  return (
                    <div key={chapter.chapter_uuid}>
                      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-2 mb-1">
                        {chapter.name}
                      </p>
                      {embeddable.map((act: any) => (
                        <button
                          key={act.activity_uuid}
                          onClick={() => handleSelectActivity(act)}
                          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors text-left"
                        >
                          <span className="text-xs text-neutral-700 truncate">{act.name}</span>
                          <span className="text-[10px] text-neutral-400 shrink-0">
                            {act.activity_type.replace('TYPE_', '')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </BoardBlockWrapper>
    )
  }

  // --- Activity set: render content ---
  const activityUrl = activity && courseMeta
    ? getUriWithOrg(
        orgslug,
        `/course/${(courseMeta.course_uuid || courseUuid).replace('course_', '')}/activity/${activityUuid.replace('activity_', '')}`
      )
    : ''

  const renderActivityContent = () => {
    if (loadingActivity || !activity) return <LoadingFallback />

    switch (activity.activity_type) {
      case 'TYPE_DYNAMIC':
        return (
          <EmbedCourseProvider>
            <Suspense fallback={<LoadingFallback />}>
              <Canva content={activity.content} activity={activity} />
            </Suspense>
          </EmbedCourseProvider>
        )
      case 'TYPE_VIDEO':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <VideoActivity activity={activity} course={courseMeta} />
          </Suspense>
        )
      case 'TYPE_DOCUMENT':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DocumentPdfActivity activity={activity} course={courseMeta} />
          </Suspense>
        )
      default:
        return (
          <div className="flex items-center justify-center h-full text-xs text-neutral-400">
            {t('boards.activity_block.unsupported_type')}
          </div>
        )
    }
  }

  const bgColorClass = activity?.activity_type === 'TYPE_DYNAMIC' ? 'bg-white' : 'bg-zinc-950'

  return (
    <BoardBlockWrapper
      selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
      x={x} y={y} width={width} height={height} stopWheel
    >
      {/* Drag handle + header */}
      <DragHandle
        onMouseDown={handleDragStart}
        height="h-8"
        className="bg-gray-50/90 border-b border-gray-100 rounded-t-xl"
      >
        <span className="text-[11px] font-medium text-neutral-600 truncate flex-1">
          {activity?.name || 'Activity'}
        </span>
        {activityUrl && (
          <a
            href={activityUrl}
            target="_blank"
            rel="noopener noreferrer"
            onMouseDown={(e) => e.stopPropagation()}
            className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
          >
            <ExternalLink size={11} />
          </a>
        )}
      </DragHandle>

      {/* Activity content */}
      <div
        className={`${bgColorClass} overflow-auto rounded-b-xl`}
        style={{ height: height - 32 }}
      >
        {renderActivityContent()}
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} color="text-neutral-300" selected={selected} />
    </BoardBlockWrapper>
  )
}
