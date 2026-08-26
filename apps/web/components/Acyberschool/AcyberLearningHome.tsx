'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, BriefcaseBusiness, CheckCircle2, Layers3 } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTrail } from '@/hooks/queries/useTrail'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'

const BRAND_RED = '#C51635'
const BRAND_NAVY = '#0B263D'

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

function CourseEntryCard({ course, orgslug, org, completed }: { course: Course; orgslug: string; org: any; completed: number }) {
  const courseId = cleanCourseUuid(course.course_uuid)
  const href = getUriWithOrg(orgslug, `/course/${courseId}`)
  const thumbnail = course.thumbnail_image && org?.org_uuid
    ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
    : null

  return (
    <article className="overflow-hidden rounded-[28px] border border-black/[0.08] bg-white shadow-[0_14px_50px_rgba(10,25,41,0.06)]">
      <div className="grid min-h-[250px] grid-cols-1 md:grid-cols-[0.9fr_1.1fr]">
        <div className="relative min-h-[180px] overflow-hidden bg-[#F1F3F5] md:min-h-full">
          {thumbnail ? (
            <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: BRAND_NAVY }}>
              <BookOpen className="h-12 w-12 text-white/80" strokeWidth={1.6} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
          <span className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#0B263D]">
            {completed > 0 ? `${completed} learning steps completed` : 'Ready to begin'}
          </span>
        </div>

        <div className="flex flex-col justify-between p-6 sm:p-8">
          <div>
            <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.2em]" style={{ color: BRAND_RED }}>
              Your course
            </p>
            <h2 className="text-2xl font-black leading-tight tracking-[-0.03em] text-[#101418] sm:text-3xl">
              {course.name}
            </h2>
            {course.description && (
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-black/55 sm:text-[15px]">
                {course.description}
              </p>
            )}
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={href}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-extrabold text-white transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: BRAND_RED }}
            >
              {completed > 0 ? 'Continue learning' : 'Enter course'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={getUriWithOrg(orgslug, '/portfolio')}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-black/10 px-5 py-3 text-sm font-bold text-[#0B263D] hover:bg-black/[0.025]"
            >
              <BriefcaseBusiness className="h-4 w-4" />
              My applied learning
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
  const firstName = session?.data?.user?.first_name || ''
  const totalCompleted = Array.isArray(trailData?.runs)
    ? trailData.runs.reduce((sum: number, run: any) => sum + (Array.isArray(run?.steps) ? run.steps.length : 0), 0)
    : 0

  return (
    <main className="min-h-[calc(100vh-60px)] bg-white text-[#101418]">
      <section className="relative overflow-hidden border-b border-black/[0.06]">
        <div className="absolute inset-y-0 right-0 hidden w-[42%] lg:block" style={{ backgroundColor: BRAND_NAVY }} />
        <div className="absolute right-[6%] top-[-160px] hidden h-[430px] w-[430px] rounded-full border-[54px] border-white/[0.045] lg:block" />

        <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.25fr_0.75fr] lg:px-10 lg:py-20">
          <div className="max-w-4xl">
            <div className="mb-7 flex items-center gap-3">
              <span className="h-[3px] w-11 rounded-full" style={{ backgroundColor: BRAND_RED }} />
              <span className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: BRAND_RED }}>
                Acyberschool learning
              </span>
            </div>

            {firstName && (
              <p className="mb-3 text-sm font-semibold text-black/45">Welcome back, {firstName}.</p>
            )}
            <h1 className="max-w-[930px] text-[40px] font-black leading-[1.02] tracking-[-0.055em] sm:text-5xl lg:text-[64px]">
              Learning should change what you are capable of applying at work, <span style={{ color: BRAND_RED }}>from day 1.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-black/58 sm:text-lg">
              Learn the concept. Apply it in your organisation. Record what changed. Keep the proof in one portfolio that grows with every programme you take.
            </p>
          </div>

          <div className="rounded-[28px] p-7 text-white lg:self-end lg:bg-transparent lg:p-8">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#FF8298]">How learning works here</p>
            <div className="mt-5 space-y-5">
              {[
                ['Learn', 'Understand the idea without unnecessary complexity.'],
                ['Apply', 'Use it in the work you are already responsible for.'],
                ['Record', 'Capture what you did and the measurable change.'],
              ].map(([title, body]) => (
                <div key={title} className="flex gap-3 border-b border-white/15 pb-5 last:border-0 last:pb-0">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#FF4968]" />
                  <div>
                    <p className="font-extrabold">{title}</p>
                    <p className="mt-1 text-sm leading-5 text-white/70">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14 lg:px-10">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em]" style={{ color: BRAND_RED }}>Your learning</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.035em] sm:text-4xl">Enter your course</h2>
          </div>
          <div className="flex items-center gap-5 text-sm text-black/50">
            <span className="flex items-center gap-2"><Layers3 className="h-4 w-4" /> {courses.length} {courses.length === 1 ? 'course' : 'courses'}</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> {totalCompleted} steps completed</span>
          </div>
        </div>

        {isLoading ? (
          <div className="h-[270px] animate-pulse rounded-[28px] bg-black/[0.04]" />
        ) : courses.length > 0 ? (
          <div className="space-y-6">
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
          <div className="rounded-[28px] border border-dashed border-black/15 bg-[#FAFAFA] px-6 py-14 text-center">
            <BookOpen className="mx-auto h-9 w-9 text-black/25" />
            <h3 className="mt-4 text-xl font-black">No course has been assigned yet.</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-black/50">When your trainer enrols you, your course will appear here and you can enter it directly.</p>
          </div>
        )}
      </section>
    </main>
  )
}
