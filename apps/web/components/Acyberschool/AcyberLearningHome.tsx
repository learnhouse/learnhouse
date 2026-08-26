'use client'

import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, BriefcaseBusiness, CheckCircle2, Layers3, Target, TrendingUp } from 'lucide-react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTrail } from '@/hooks/queries/useTrail'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { getAppliedLearningSummary } from '@services/applied-learning/appliedLearning'

const RED = '#C51635'
const NAVY = '#0B263D'

type Course = {
  course_uuid: string
  name: string
  description?: string
  thumbnail_image?: string
  published?: boolean
}

const cleanCourseUuid = (uuid: string) => uuid?.replace('course_', '')

function completedForCourse(trailData: any, courseUuid: string) {
  const clean = cleanCourseUuid(courseUuid)
  const run = trailData?.runs?.find((item: any) => cleanCourseUuid(item?.course?.course_uuid) === clean)
  return Array.isArray(run?.steps) ? run.steps.length : 0
}

function JourneyProgress({ courses, learned, applied, measured }: { courses: number; learned: number; applied: number; measured: number }) {
  const stages = [
    { label: 'Courses', value: courses, helper: 'Your assigned learning', icon: Layers3 },
    { label: 'Learned', value: learned, helper: 'Learning steps completed', icon: BookOpen },
    { label: 'Applied', value: applied, helper: 'Ideas used at work', icon: Target },
    { label: 'Measured', value: measured, helper: 'Applications with a result', icon: TrendingUp },
  ]

  return (
    <section className="overflow-hidden rounded-[24px] border border-black/[0.07] bg-[#F7F8FA]" aria-label="Your learning journey">
      <div className="border-b border-black/[0.06] px-5 py-4 sm:px-6">
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>Your progress</p>
        <p className="mt-1 text-sm font-bold text-[#101418]">Learning only counts here when it moves into application.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {stages.map((stage, index) => {
          const Icon = stage.icon
          return (
            <div
              key={stage.label}
              className={`relative p-5 sm:p-6 ${index % 2 === 0 ? 'border-r border-black/[0.06]' : ''} ${index < 2 ? 'border-b border-black/[0.06] lg:border-b-0' : ''} ${index > 0 ? 'lg:border-l lg:border-black/[0.06]' : ''} lg:border-r-0`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-black/42">{stage.label}</p>
                  <p className="mt-1 text-3xl font-black tracking-[-0.05em]" style={{ color: index < 2 ? NAVY : RED }}>{stage.value}</p>
                </div>
                <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm sm:flex">
                  <Icon className="h-4 w-4" style={{ color: index < 2 ? NAVY : RED }} />
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-black/45">{stage.helper}</p>
            </div>
          )
        })}
      </div>
      <div className="h-1.5 bg-black/[0.04]">
        <div
          className="h-full transition-all"
          style={{ width: learned > 0 ? `${Math.min(100, (measured / learned) * 100)}%` : '0%', backgroundColor: RED }}
        />
      </div>
    </section>
  )
}

function CourseEntryCard({ course, orgslug, org, completed }: { course: Course; orgslug: string; org: any; completed: number }) {
  const courseId = cleanCourseUuid(course.course_uuid)
  const href = getUriWithOrg(orgslug, `/course/${courseId}`)
  const thumbnail = course.thumbnail_image && org?.org_uuid
    ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
    : null

  return (
    <article className="overflow-hidden rounded-[24px] border border-black/[0.08] bg-white shadow-[0_12px_40px_rgba(11,38,61,0.055)]">
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr]">
        <div className="relative min-h-[170px] overflow-hidden bg-[#F1F3F5] md:min-h-[220px]">
          {thumbnail ? (
            <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: NAVY }}>
              <BookOpen className="h-11 w-11 text-white/75" strokeWidth={1.6} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          <span className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#0B263D]">
            {completed > 0 ? `${completed} steps completed` : 'Ready to begin'}
          </span>
        </div>

        <div className="flex flex-col justify-between p-5 sm:p-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>Your course</p>
            <h3 className="mt-2 text-2xl font-black leading-tight tracking-[-0.035em] text-[#101418]">{course.name}</h3>
            {course.description && <p className="mt-3 line-clamp-3 text-sm leading-6 text-black/52">{course.description}</p>}
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href={href}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-extrabold text-white sm:flex-none"
              style={{ backgroundColor: RED }}
            >
              {completed > 0 ? 'Continue learning' : 'Enter course'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={getUriWithOrg(orgslug, '/portfolio')}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-black/10 px-4 py-3 text-sm font-bold text-[#0B263D] hover:bg-black/[0.025]"
            >
              <BriefcaseBusiness className="h-4 w-4" />
              Portfolio
            </Link>
          </div>
        </div>
      </div>
    </article>
  )
}

export default function AcyberLearningHome({ orgslug, courses = [], isLoading = false }: { orgslug: string; courses?: Course[]; isLoading?: boolean }) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { data: trailData } = useTrail(org?.id)
  const token = session?.data?.tokens?.access_token as string | undefined
  const firstName = session?.data?.user?.first_name || ''
  const totalCompleted = Array.isArray(trailData?.runs)
    ? trailData.runs.reduce((sum: number, run: any) => sum + (Array.isArray(run?.steps) ? run.steps.length : 0), 0)
    : 0

  const { data: appliedSummary } = useQuery({
    queryKey: ['applied-learning', 'summary', org?.id],
    queryFn: () => getAppliedLearningSummary(org?.id, token),
    enabled: !!org?.id && session?.status === 'authenticated',
    staleTime: 30_000,
  })

  return (
    <main className="min-h-[calc(100vh-60px)] bg-white pb-3 text-[#101418]">
      <section className="relative overflow-hidden border-b border-black/[0.06]">
        <div className="absolute inset-y-0 right-0 hidden w-[40%] lg:block" style={{ backgroundColor: NAVY }} />
        <div className="relative mx-auto grid w-full max-w-7xl gap-8 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-18">
          <div className="max-w-4xl">
            <div className="mb-6 flex items-center gap-3">
              <span className="h-[3px] w-10 rounded-full" style={{ backgroundColor: RED }} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>Acyberschool learning</span>
            </div>
            {firstName && <p className="mb-3 text-sm font-semibold text-black/45">Welcome back, {firstName}.</p>}
            <h1 className="max-w-[900px] text-[38px] font-black leading-[1.03] tracking-[-0.055em] sm:text-5xl lg:text-[62px]">
              Learning should change what you are capable of applying at work, <span style={{ color: RED }}>from day 1.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-black/55 sm:text-lg">
              Learn the concept. Apply it in your organisation. Record what changed. Your portfolio grows with every programme you take.
            </p>
          </div>

          <div className="rounded-[24px] p-6 text-white lg:self-end lg:bg-transparent lg:p-8" style={{ backgroundColor: NAVY }}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FF8298]">How learning works here</p>
            <div className="mt-4 space-y-4">
              {[
                ['Learn', 'Understand the concept without unnecessary complexity.'],
                ['Apply', 'Use it in the work you are already responsible for.'],
                ['Measure', 'Record what changed and keep the result in your portfolio.'],
              ].map(([title, body]) => (
                <div key={title} className="flex gap-3 border-b border-white/15 pb-4 last:border-0 last:pb-0">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6680]" />
                  <div>
                    <p className="text-sm font-extrabold">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-white/68">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-9 sm:px-8 sm:py-12 lg:px-10">
        <JourneyProgress
          courses={courses.length}
          learned={totalCompleted}
          applied={appliedSummary?.applied || 0}
          measured={appliedSummary?.measured || 0}
        />

        <div className="mb-6 mt-10 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>Your learning</p>
            <h2 className="mt-1 text-3xl font-black tracking-[-0.04em]">Enter your course</h2>
          </div>
          <p className="text-sm text-black/42">{courses.length} {courses.length === 1 ? 'course' : 'courses'} assigned</p>
        </div>

        {isLoading ? (
          <div className="h-[240px] animate-pulse rounded-[24px] bg-black/[0.04]" />
        ) : courses.length > 0 ? (
          <div className="space-y-5">
            {courses.map((course) => (
              <CourseEntryCard
                key={course.course_uuid}
                course={course}
                orgslug={orgslug}
                org={org}
                completed={completedForCourse(trailData, course.course_uuid)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-black/15 bg-[#FAFAFA] px-6 py-12 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-black/20" />
            <h3 className="mt-4 text-lg font-black">No course has been assigned yet.</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-black/48">When your trainer enrols you, your course will appear here and you can enter it directly.</p>
          </div>
        )}
      </section>
    </main>
  )
}
