'use client'
import React from 'react'
import Link from 'next/link'
import { ArrowRight, CircleNotch, FileText, PencilLine } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Panel } from '@/design'
import { AIMark } from '@components/Objects/AI/AIBrand'
import { useHomeCourses } from '@components/Dashboard/Home/homeData'
import { useFirstCourse } from './useFirstCourse'

const noSubscribe = () => () => {}

/**
 * A new school's dashboard leads with its first course: one panel, three ways
 * in (a ready draft from the template, the AI course builder, a blank course).
 * Shown until the org has a course. Arriving from org creation with
 * `?first=ai` (sell / teach goals) opens the AI builder right away.
 */
export default function FirstCourseHero() {
  const { t } = useTranslation()
  const { data: courses, isLoading } = useHomeCourses()
  const { canUseAI, busy, startTemplate, startAI, aiModal } = useFirstCourse('home_hero')
  const search = React.useSyncExternalStore(noSubscribe, () => window.location.search, () => '')
  const autoOpened = React.useRef(false)
  const noCourses = !isLoading && Array.isArray(courses) && courses.length === 0
  const wantsAI = new URLSearchParams(search).get('first') === 'ai'

  React.useEffect(() => {
    if (!noCourses || !wantsAI || !canUseAI || autoOpened.current) return
    autoOpened.current = true
    startAI()
  }, [noCourses, wantsAI, canUseAI, startAI])

  if (!noCourses) return aiModal

  const option =
    'group relative flex w-full items-start gap-3 rounded-2xl bg-white p-4 text-start ring-1 ring-inset ring-neutral-200/80 transition-all hover:ring-neutral-300 hover:shadow-sm disabled:opacity-60'
  const aiFirst = canUseAI && wantsAI

  const template = (
    <button key="template" type="button" className={`${option} ${aiFirst ? '' : 'ring-2 ring-neutral-900 hover:ring-neutral-900'}`} onClick={startTemplate} disabled={!!busy} data-first-course="template">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
        {busy === 'template' ? <CircleNotch size={18} className="animate-spin" /> : <FileText size={18} weight="duotone" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-neutral-900">{t('onb2.first_course.template')}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">{t('onb2.first_course.template_desc')}</span>
      </span>
    </button>
  )
  const ai = canUseAI ? (
    <button key="ai" type="button" className={`${option} ${aiFirst ? 'ring-2 ring-violet-500 hover:ring-violet-500' : ''}`} onClick={startAI} data-first-course="ai">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50">
        <AIMark size={22} alt="" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-neutral-900">{t('onb2.first_course.ai')}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">{t('onb2.first_course.ai_desc')}</span>
      </span>
    </button>
  ) : null

  return (
    <Panel className="p-5 sm:p-6" data-testid="first-course-hero">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">{t('onb2.first_course.title')}</h2>
        <p className="text-sm text-neutral-500">{t('onb2.first_course.subtitle')}</p>
      </div>
      <div className={`mt-4 grid grid-cols-1 gap-3 ${ai ? 'md:grid-cols-2' : ''}`}>
        {aiFirst ? [ai, template] : [template, ai]}
      </div>
      <Link
        href="/dash/courses?new=true"
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900"
        data-first-course="blank"
      >
        <PencilLine size={13} />
        {t('onb2.first_course.blank')}
        <ArrowRight size={11} data-dir-flip="" />
      </Link>
      {aiModal}
    </Panel>
  )
}
