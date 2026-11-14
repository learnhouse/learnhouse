'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, BookOpen, Certificate, ChartLineUp, DotsThree, Plus, SealCheck, SignOut } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { Button, Chip, ConfirmDialog, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { unenrollMember, type MemberCourse, type MemberSummary } from '@services/organizations/memberPanel'
import { ListSkeleton, P, PanelSection, ProgressBar, QuietEmpty, dateOnly } from '../panelUi'
import { useInvalidateMember, usePanelAuth } from '../panelState'

export default function LearningTab({
  userId,
  name,
  summary,
  canManage,
  analytics,
  onEnroll,
}: {
  userId: number
  name: string
  summary?: MemberSummary
  canManage: boolean
  analytics: boolean
  onEnroll: () => void
}) {
  const { t, i18n } = useTranslation()
  const { orgId, token } = usePanelAuth()
  const invalidate = useInvalidateMember()
  const [leaving, setLeaving] = useState<MemberCourse | null>(null)

  if (!summary) return <ListSkeleton rows={4} />

  const unenroll = async (course: MemberCourse) => {
    const res = await unenrollMember(orgId!, userId, course.course_uuid, token!)
    if (res.success) toast.success(t(`${P}.learning.unenrolled`, { course: course.name }))
    else toast.error(t(`${P}.learning.unenroll_error`))
    await invalidate()
  }

  const inProgress = summary.courses.filter((c) => !c.completed)
  const done = summary.courses.filter((c) => c.completed)

  return (
    <div className="flex flex-col gap-5">
      <PanelSection
        title={t(`${P}.learning.courses_title`, { count: summary.courses.length })}
        flush
        end={
          canManage ? (
            <Button size="sm" variant="ghost" icon={<Plus size={13} weight="bold" />} onClick={onEnroll}>
              {t(`${P}.actions.enroll`)}
            </Button>
          ) : undefined
        }
      >
        {summary.courses.length === 0 ? (
          <QuietEmpty
            icon={<BookOpen size={18} />}
            title={t(`${P}.learning.empty`)}
            hint={t(`${P}.learning.empty_hint`, { name })}
            action={
              canManage ? (
                <Button size="sm" icon={<Plus size={13} weight="bold" />} onClick={onEnroll}>
                  {t(`${P}.actions.enroll`)}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {[...inProgress, ...done].map((c) => (
              <CourseRow
                key={c.course_uuid}
                course={c}
                certified={summary.certificates.some((cert) => cert.course_uuid === c.course_uuid)}
                canManage={canManage}
                analytics={analytics}
                onUnenroll={() => setLeaving(c)}
              />
            ))}
          </ul>
        )}
      </PanelSection>

      {summary.certificates.length > 0 && (
        <PanelSection title={t(`${P}.learning.certificates_title`)} flush>
          <ul className="divide-y divide-neutral-100">
            {summary.certificates.map((c) => (
              <li key={c.user_certification_uuid} className="flex items-center gap-3 px-4 py-3">
                <span className="w-8 h-8 rounded-[10px] bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <Certificate size={16} weight="duotone" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-800 truncate" dir="auto">
                    {c.course_name}
                  </p>
                  <p className="text-[11px] text-neutral-400">{dateOnly(c.created_at, i18n.language)}</p>
                </div>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(null)}
        title={t(`${P}.learning.unenroll_title`)}
        message={leaving ? t(`${P}.learning.unenroll_message`, { name, course: leaving.name }) : ''}
        confirmLabel={t(`${P}.learning.unenroll`)}
        onConfirm={async () => {
          if (leaving) await unenroll(leaving)
        }}
      />
    </div>
  )
}

function CourseRow({
  course,
  certified,
  canManage,
  analytics,
  onUnenroll,
}: {
  course: MemberCourse
  certified: boolean
  canManage: boolean
  analytics: boolean
  onUnenroll: () => void
}) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const params = useParams() as any
  const clean = course.course_uuid.replace('course_', '')
  const courseHref = getUriWithOrg(params?.orgslug, `/dash/courses/course/${clean}/${analytics ? 'analytics' : 'general'}`)
  const publicHref = getUriWithOrg(params?.orgslug, `/course/${clean}`)
  const thumb =
    course.thumbnail_image && org?.org_uuid
      ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
      : null
  const last = course.last_activity_at ? formatRelative(course.last_activity_at, i18n.language) : null

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="w-14 h-9 @[720px]:w-20 @[720px]:h-12 rounded-lg overflow-hidden bg-neutral-100 shrink-0 ring-1 ring-black/5">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="w-full h-full flex items-center justify-center text-neutral-400">
            <BookOpen size={15} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link href={courseHref} className="text-sm font-medium text-neutral-900 truncate hover:underline underline-offset-2" dir="auto">
            {course.name}
          </Link>
          {course.completed && (
            <Chip tone="emerald" icon={<SealCheck size={11} weight="fill" />} className="!px-1.5 !py-0.5 !text-[10px]">
              {t(`${P}.learning.completed`)}
            </Chip>
          )}
          {!course.published && (
            <Chip className="!px-1.5 !py-0.5 !text-[10px]">{t(`${P}.learning.draft`)}</Chip>
          )}
        </div>
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] @[720px]:grid-cols-[minmax(0,1fr)_9rem] items-center gap-3">
          <ProgressBar value={course.progress} done={course.completed} />
          <span className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
            {t(`${P}.learning.steps`, { done: course.activities_completed, total: course.activities_total })}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-400 flex flex-wrap gap-x-2">
          {last && <span>{t(`${P}.learning.last_activity`, { when: last })}</span>}
          <span className={last ? 'hidden @[720px]:inline' : ''}>{t(`${P}.learning.enrolled_on`, { date: dateOnly(course.enrolled_at, i18n.language) })}</span>
          {certified && (
            <span className="inline-flex items-center gap-1 text-rose-600">
              <Certificate size={11} weight="fill" /> {t(`${P}.learning.certified`)}
            </span>
          )}
        </p>
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t(`${P}.learning.course_actions`, { course: course.name })}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 shrink-0"
          >
            <DotsThree size={16} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
          <DropdownMenuItem asChild>
            <Link href={courseHref} className="flex items-center gap-2 cursor-pointer">
              <ChartLineUp size={15} className="text-sky-600" /> {t(analytics ? `${P}.learning.course_analytics` : `${P}.learning.open_course`)}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={publicHref} className="flex items-center gap-2 cursor-pointer" target="_blank">
              <ArrowSquareOut size={15} className="text-neutral-500" /> {t(`${P}.learning.view_course`)}
            </Link>
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onUnenroll} className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50">
                <SignOut size={15} /> {t(`${P}.learning.unenroll`)}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
