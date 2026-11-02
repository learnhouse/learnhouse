'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Award, Check, Lock, Route } from 'lucide-react'
import toast from 'react-hot-toast'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview'
import { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory, getPathThumbnailMediaDirectory } from '@services/media/media'
import { enrollInPath, leavePath, Path, PathCourseItem, removePathPrefix } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'
import { usePath } from '@/hooks/queries/usePaths'

// Same box the course page uses for its sidebar and lesson list.
const BOX = 'bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden'

export default function PathClient({ orgslug, pathuuid }: { orgslug: string; pathuuid: string }) {
  const { t } = useTranslation()
  const { data: path, isLoading, isError } = usePath(`path_${pathuuid}`)

  return (
    <FeatureGate feature="paths" orgslug={orgslug} context="public">
      <GeneralWrapperStyled>
        {isLoading && <PathSkeleton />}
        {isError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Route className="w-10 h-10 text-gray-300 mb-3" />
            <h1 className="text-xl font-bold text-gray-700">{t('paths.not_found')}</h1>
            <Link href={getUriWithOrg(orgslug, '/paths')} className="mt-4 text-sm font-medium text-gray-500 hover:text-gray-900">
              {t('paths.back_to_paths')}
            </Link>
          </div>
        )}
        {path && <PathView path={path} orgslug={orgslug} />}
      </GeneralWrapperStyled>
    </FeatureGate>
  )
}

function PathView({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const user = session?.data?.user
  const signedIn = session?.status === 'authenticated'
  const learnerName = signedIn
    ? [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username
    : undefined

  const progress = path.progress
  const enrolled = !!progress?.enrolled
  const completed = !!progress?.completed
  const nextCourse = enrolled && !completed
    ? path.courses.find((c) => !c.completed && !c.locked && !c.course.restricted)
    : undefined
  const electives = path.courses.filter((c) => !c.required)
  const cover = path.thumbnail_image
    ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image)
    : '/empty_thumbnail.png'
  const meta = [
    t('paths.course_count', { count: path.course_count }),
    path.level ? t(`paths.levels.${path.level}`) : t('paths.levels.all'),
    path.sequential ? t('paths.guided_order') : null,
  ].filter(Boolean) as string[]

  return (
    <div className="pb-10">
      <div className="pb-4">
        <Breadcrumbs
          items={[
            { label: t('paths.title'), href: getUriWithOrg(orgslug, '/paths'), icon: <Route size={14} /> },
            { label: path.name },
          ]}
        />
      </div>
      <h1 className="text-3xl font-bold pb-2" dir="auto">{path.name}</h1>

      <div className="flex flex-col md:flex-row gap-8 pt-2">
        <div className="w-full md:w-3/4">
          <div
            className="ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full h-[200px] md:h-[400px] bg-cover bg-center"
            style={{ backgroundImage: `url(${cover})` }}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-5 text-sm font-medium text-neutral-500">
            {meta.map((item, i) => (
              <React.Fragment key={item}>
                {i > 0 && <span className="text-neutral-300">·</span>}
                <span>{item}</span>
              </React.Fragment>
            ))}
          </div>
          <p className="py-4 whitespace-pre-line break-words leading-relaxed text-pretty" dir="auto">
            {path.about || path.description}
          </p>
        </div>

        <div className="w-full md:w-1/4 space-y-4">
          <PathActions path={path} orgslug={orgslug} nextCourse={nextCourse} signedIn={signedIn} />
          {path.certificate_enabled && (
            <div className={`${BOX} p-4 space-y-3`}>
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
                <Award size={13} />
                {completed && progress?.certificate_uuid ? t('paths.certificate_earned') : t('paths.certificate_included')}
              </div>
              <div className="rounded-sm overflow-hidden ring-1 ring-black/5 shadow-sm pointer-events-none select-none">
                <CertificatePreview
                  certificationName={path.certificate_config.certification_name || path.name}
                  certificationDescription={path.certificate_config.certification_description || path.description}
                  certificationType={path.certificate_config.certification_type || 'specialization'}
                  certificatePattern={path.certificate_config.certificate_pattern}
                  certificateInstructor={path.certificate_config.certificate_instructor}
                  certificateId={progress?.certificate_uuid || undefined}
                  learnerName={learnerName}
                />
              </div>
              {completed && progress?.certificate_uuid ? (
                <Link
                  href={getUriWithOrg(orgslug, `/paths/certificate/${progress.certificate_uuid}`)}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-neutral-700 hover:text-neutral-900"
                >
                  {t('paths.view_certificate')}
                  <ArrowRight size={14} className="rtl:rotate-180" />
                </Link>
              ) : (
                <p className="text-xs text-neutral-500 leading-relaxed">{t('paths.certificate_explainer')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="w-full my-5">
        <div className="flex items-end justify-between gap-3">
          <h2 className="py-5 text-xl md:text-2xl font-bold">{t('paths.courses_in_path')}</h2>
          {electives.length > 0 && path.electives_required > 0 && (
            <span className="pb-5 text-sm text-neutral-500">
              {t('paths.electives_rule', {
                count: Math.min(path.electives_required, electives.length),
                total: electives.length,
              })}
            </span>
          )}
        </div>
        {path.courses.length === 0 ? (
          <div className={`${BOX} p-8 text-center text-sm text-neutral-500`}>{t('paths.no_courses_yet')}</div>
        ) : (
          <ol className={`${BOX} divide-y divide-neutral-100`}>
            {path.courses.map((item, index) => (
              <PathCourseRow
                key={item.course_uuid}
                item={item}
                index={index}
                orgslug={orgslug}
                orgUuid={org?.org_uuid}
                isNext={nextCourse?.course_uuid === item.course_uuid}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function ProgressRing({ value }: { value: number }) {
  const r = 28
  const circumference = 2 * Math.PI * r
  return (
    <svg className="w-full h-full -rotate-90">
      <circle cx="32" cy="32" r={r} stroke="#e5e7eb" strokeWidth="6" fill="none" />
      <circle
        cx="32"
        cy="32"
        r={r}
        stroke="#10b981"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value / 100)}
        className="transition-all duration-500 ease-out"
      />
    </svg>
  )
}

function PathActions({
  path,
  orgslug,
  nextCourse,
  signedIn,
}: {
  path: Path
  orgslug: string
  nextCourse?: PathCourseItem
  signedIn: boolean
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const accessToken = session?.data?.tokens?.access_token
  const progress = path.progress
  const enrolled = !!progress?.enrolled
  const completed = !!progress?.completed
  const started = enrolled || completed

  const refresh = (updated?: Path) => {
    if (updated) queryClient.setQueryData(queryKeys.paths.detail(path.path_uuid), updated)
    else queryClient.invalidateQueries({ queryKey: queryKeys.paths.detail(path.path_uuid) })
    queryClient.invalidateQueries({ queryKey: queryKeys.paths.list(path.org_id) })
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true)
    try {
      await action()
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, fallback))
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      const updated = await enrollInPath(path.path_uuid, accessToken)
      refresh(updated)
      if (updated.progress?.completed) toast.success(t('paths.toasts.already_completed'))
    }, t('paths.toasts.enroll_error'))

  const leave = () =>
    run(async () => {
      await leavePath(path.path_uuid, accessToken)
      refresh()
    }, t('paths.toasts.save_error'))

  const primary =
    'w-full bg-neutral-900 text-white py-3 px-3 rounded-lg nice-shadow font-semibold hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2 disabled:bg-neutral-700'

  let cta: React.ReactNode = null
  if (!signedIn) {
    cta = (
      <Link
        href={getUriWithOrg(orgslug, `/login?redirect=${encodeURIComponent(`/path/${removePathPrefix(path.path_uuid)}`)}`)}
        className={primary}
      >
        {t('paths.sign_in_to_start')}
        <ArrowRight className="w-5 h-5 rtl:rotate-180" />
      </Link>
    )
  } else if (completed && progress?.certificate_uuid) {
    cta = (
      <Link href={getUriWithOrg(orgslug, `/paths/certificate/${progress.certificate_uuid}`)} className={primary}>
        <Award className="w-5 h-5" />
        {t('paths.view_certificate')}
      </Link>
    )
  } else if (enrolled && nextCourse) {
    cta = (
      <Link href={getUriWithOrg(orgslug, `/course/${removeCoursePrefix(nextCourse.course_uuid)}`)} className={primary}>
        <span className="truncate">{t('paths.continue_learning')}</span>
        <ArrowRight className="w-5 h-5 rtl:rotate-180 shrink-0" />
      </Link>
    )
  } else if (!enrolled) {
    cta = (
      <button type="button" onClick={start} disabled={busy || path.courses.length === 0} className={primary}>
        {busy ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            {t('paths.start_path')}
            <ArrowRight className="w-5 h-5 rtl:rotate-180" />
          </>
        )}
      </button>
    )
  }

  return (
    <div className={`${BOX} p-4 space-y-4`}>
      <div className="relative bg-white nice-shadow rounded-lg overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: 'radial-gradient(circle at center, #101010 1px, transparent 1px)', backgroundSize: '12px 12px' }}
        />
        <div className="relative p-4 flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0">
            <ProgressRing value={started ? progress!.percent : 0} />
            <div className="absolute inset-0 flex items-center justify-center">
              {started ? (
                <span className="text-lg font-bold text-gray-800">{progress!.percent}%</span>
              ) : (
                <Route className="w-6 h-6 text-neutral-400" />
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">
              {completed ? t('paths.completed') : started ? t('paths.your_progress') : t('paths.ready_to_begin')}
            </div>
            <div className="text-sm text-gray-500">
              {started
                ? t('paths.progress_long', { done: progress!.courses_done, total: progress!.courses_needed })
                : t('paths.start_hint')}
            </div>
          </div>
        </div>
      </div>
      {cta}
      {enrolled && !completed && (
        <button
          type="button"
          onClick={leave}
          disabled={busy}
          className="w-full text-xs font-medium text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          {t('paths.leave_path')}
        </button>
      )}
    </div>
  )
}

function PathCourseRow({
  item,
  index,
  orgslug,
  orgUuid,
  isNext,
}: {
  item: PathCourseItem
  index: number
  orgslug: string
  orgUuid: string
  isNext: boolean
}) {
  const { t } = useTranslation()
  const course = item.course
  const blocked = item.locked || !!course.restricted
  const thumb = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
    : '/empty_thumbnail.png'

  const status = item.completed ? (
    <span className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center">
      <Check size={13} strokeWidth={3} />
    </span>
  ) : blocked ? (
    <span className="w-6 h-6 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center">
      <Lock size={12} />
    </span>
  ) : (
    <span className="w-6 h-6 rounded-full bg-neutral-200 text-neutral-600 border border-neutral-300 text-xs font-semibold flex items-center justify-center">
      {index + 1}
    </span>
  )

  const details = [
    item.required ? t('paths.required') : t('paths.elective'),
    item.locked ? t('paths.locked_hint') : null,
    item.started && !item.completed ? t('paths.percent_done', { percent: item.progress }) : null,
  ].filter(Boolean)

  const inner = (
    <div className="flex items-center gap-4 px-4 py-4">
      <div className="shrink-0">{status}</div>
      <div
        className="w-24 aspect-video rounded-md ring-1 ring-inset ring-black/10 bg-neutral-100 bg-cover bg-center shrink-0"
        style={{ backgroundImage: course.restricted ? undefined : `url(${thumb})` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p
            className={`font-semibold truncate ${blocked ? 'text-neutral-400' : 'text-neutral-700 group-hover:text-neutral-900'}`}
            dir="auto"
          >
            {course.restricted ? t('paths.restricted_course') : course.name}
          </p>
          {isNext && (
            <span className="shrink-0 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs font-semibold">
              {t('paths.up_next')}
            </span>
          )}
        </div>
        <div className="text-xs font-medium text-neutral-400 mt-0.5 truncate">{details.join(' · ')}</div>
      </div>
      {!blocked && <ArrowRight size={14} className="text-neutral-300 group-hover:text-neutral-400 rtl:rotate-180 shrink-0" />}
    </div>
  )

  return (
    <li>
      {blocked ? (
        <div className="cursor-not-allowed select-none">{inner}</div>
      ) : (
        <Link
          href={getUriWithOrg(orgslug, `/course/${removeCoursePrefix(item.course_uuid)}`)}
          className="block group hover:bg-neutral-50 transition-colors"
        >
          {inner}
        </Link>
      )}
    </li>
  )
}

function PathSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-40 bg-gray-100 rounded-lg" />
      <div className="h-9 w-72 bg-gray-200 rounded" />
      <div className="flex flex-col md:flex-row gap-8 pt-2">
        <div className="w-full md:w-3/4 h-[200px] md:h-[400px] bg-gray-100 rounded-lg" />
        <div className="w-full md:w-1/4 h-48 bg-white rounded-lg nice-shadow" />
      </div>
    </div>
  )
}
