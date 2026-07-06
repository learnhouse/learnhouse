'use client'
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import NewAssignment from '@components/Objects/Modals/Activities/Create/NewActivityModal/AssignmentActivityModal'
import { getCourse } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { ArrowLeft, BookOpen, Layers, FolderPlus, ChevronRight, PlusCircle, Backpack } from 'lucide-react'

const cleanCourseUuid = (u: string) => u?.replace(/^course_/, '') ?? u

// Multi-step "create an assignment from anywhere" flow: choose a course, then a
// chapter, then the standard assignment form (reused from the course editor).
export default function NewAssignmentModal({
  open,
  onClose,
  courses,
  org,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  courses: any[] | undefined
  org: any
  onCreated?: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [step, setStep] = useState<'course' | 'chapter' | 'form'>('course')
  const [selectedCourseUuid, setSelectedCourseUuid] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)

  const { data: courseDetail, isLoading: courseLoading } = useQuery({
    queryKey: ['assignment-course-structure', selectedCourseUuid],
    queryFn: () => getCourse(selectedCourseUuid as string, null, access_token),
    enabled: !!selectedCourseUuid && !!access_token && open,
    staleTime: 30_000,
  })

  const reset = () => {
    setStep('course')
    setSelectedCourseUuid(null)
    setSelectedChapterId(null)
  }
  const handleClose = () => {
    reset()
    onClose()
  }
  const handleCreated = () => {
    onCreated?.()
    handleClose()
  }

  const chapters: any[] = courseDetail?.chapters || []
  const courseWrapper = courseDetail
    ? { courseStructure: courseDetail, withUnpublishedActivities: false }
    : null

  const rowBtn =
    'w-full flex items-center gap-3 rounded-xl border border-gray-100 bg-white nice-shadow px-4 py-3 text-left hover:bg-gray-50/60 transition-colors'

  const content = (
    <div className="space-y-4">
      {/* ---- Step 1: choose a course ---- */}
      {step === 'course' && (
        <>
          <StepHint
            icon={<BookOpen size={15} className="text-gray-400" />}
            text={t('dashboard.assignments.create_flow.pick_course', {
              defaultValue: 'Choose the course this assignment belongs to.',
            })}
          />
          {courses && courses.length > 0 ? (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {courses.map((c: any) => (
                <button
                  key={c.course_uuid}
                  onClick={() => {
                    setSelectedCourseUuid(cleanCourseUuid(c.course_uuid))
                    setStep('chapter')
                  }}
                  className={rowBtn}
                >
                  {c.thumbnail_image ? (
                    <div
                      className="w-[52px] h-[30px] rounded-md ring-1 ring-inset ring-black/10 bg-cover flex-none"
                      style={{
                        backgroundImage: `url(${getCourseThumbnailMediaDirectory(org?.org_uuid, c.course_uuid, c.thumbnail_image)})`,
                      }}
                    />
                  ) : (
                    <div className="w-[52px] h-[30px] rounded-md ring-1 ring-inset ring-black/10 bg-gray-100 flex-none" />
                  )}
                  <span className="flex-1 min-w-0 truncate font-semibold text-gray-800">{c.name}</span>
                  <ChevronRight size={16} className="text-gray-300 flex-none" />
                </button>
              ))}
            </div>
          ) : (
            // No courses → invite to create one first.
            <EmptyCta
              icon={<FolderPlus size={26} />}
              title={t('dashboard.assignments.create_flow.no_courses_title', {
                defaultValue: 'Create a course first',
              })}
              desc={t('dashboard.assignments.create_flow.no_courses_desc', {
                defaultValue: 'Assignments live inside a course chapter. Create your first course, then come back to add an assignment.',
              })}
              href={getUriWithOrg(org?.slug, '/dash/courses')}
              cta={t('dashboard.assignments.create_flow.create_course', { defaultValue: 'Create a course' })}
              onNavigate={handleClose}
            />
          )}
        </>
      )}

      {/* ---- Step 2: choose a chapter ---- */}
      {step === 'chapter' && (
        <>
          <BackRow onClick={() => setStep('course')} label={courseDetail?.name} />
          <StepHint
            icon={<Layers size={15} className="text-gray-400" />}
            text={t('dashboard.assignments.create_flow.pick_chapter', {
              defaultValue: 'Choose the chapter to place this assignment in.',
            })}
          />
          {courseLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : chapters.length > 0 ? (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {chapters.map((ch: any, i: number) => (
                <button
                  key={ch.chapter_uuid || ch.id}
                  onClick={() => {
                    setSelectedChapterId(ch.id)
                    setStep('form')
                  }}
                  className={rowBtn}
                >
                  <span className="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center flex-none">
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0 truncate font-semibold text-gray-800">
                    {ch.name || t('dashboard.assignments.create_flow.untitled_chapter', { defaultValue: 'Untitled chapter' })}
                  </span>
                  <ChevronRight size={16} className="text-gray-300 flex-none" />
                </button>
              ))}
            </div>
          ) : (
            // Course has no chapters → send them to the editor to add one.
            <EmptyCta
              icon={<Layers size={26} />}
              title={t('dashboard.assignments.create_flow.no_chapters_title', {
                defaultValue: 'This course has no chapters yet',
              })}
              desc={t('dashboard.assignments.create_flow.no_chapters_desc', {
                defaultValue: 'Add a chapter in the course editor, then create an assignment inside it.',
              })}
              href={getUriWithOrg(org?.slug, `/dash/courses/course/${cleanCourseUuid(selectedCourseUuid || '')}/content`)}
              cta={t('dashboard.assignments.create_flow.open_editor', { defaultValue: 'Open course editor' })}
              onNavigate={handleClose}
            />
          )}
        </>
      )}

      {/* ---- Step 3: the assignment form (reused from the course editor) ---- */}
      {step === 'form' && courseWrapper && selectedChapterId != null && (
        <>
          <BackRow onClick={() => setStep('chapter')} label={courseDetail?.name} />
          <NewAssignment
            course={courseWrapper}
            chapterId={selectedChapterId}
            closeModal={handleCreated}
            submitActivity={() => {}}
          />
        </>
      )}
    </div>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => { if (!o) handleClose() }}
      minWidth="sm"
      dialogTitle={
        <span className="flex items-center gap-2">
          <Backpack size={20} className="text-amber-500" />
          {t('dashboard.assignments.create_flow.title', { defaultValue: 'New Assignment' })}
        </span>
      }
      dialogContent={content}
    />
  )
}

function StepHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      {icon}
      <span>{text}</span>
    </div>
  )
}

function BackRow({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
    >
      <ArrowLeft size={14} />
      <span className="truncate max-w-[220px]">{label || 'Back'}</span>
    </button>
  )
}

function EmptyCta({
  icon,
  title,
  desc,
  href,
  cta,
  onNavigate,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  href: string
  cta: string
  onNavigate: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-4 gap-3">
      <div className="bg-gray-100 text-gray-400 rounded-2xl p-4">{icon}</div>
      <p className="font-bold text-gray-800">{title}</p>
      <p className="text-sm text-gray-500 max-w-sm">{desc}</p>
      <Link
        href={href}
        onClick={onNavigate}
        className="mt-1 inline-flex items-center gap-1.5 bg-black text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-gray-800 transition-colors"
      >
        <PlusCircle size={15} />
        {cta}
      </Link>
    </div>
  )
}
