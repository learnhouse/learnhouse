'use client'
import React from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAIFeature from '@components/Hooks/useAIFeature'
import { getUriWithOrg } from '@services/config/config'
import { createFirstCourse } from '@services/onboarding/onboarding'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { COURSE_BUILDER_AVAILABLE } from '@ee/components/Atlas/CourseBuilder/availability'

// Same AI creators as the courses page: the Atlas course builder with EE, the
// classic AI creator otherwise. Loaded only when opened.
const CourseBuilderModal = dynamic(() => import('@ee/components/Atlas/CourseBuilder/CourseBuilderModal'), { ssr: false })
const AICourseCreationModal = dynamic(
  () => import('@components/Objects/Modals/Course/Create/AICourse/AICourseCreationModal'),
  { ssr: false }
)

/** Where a course is edited, from its uuid. */
export function courseEditorPath(courseUuid: string): string {
  return `/dash/courses/course/${courseUuid.replace(/^course_/, '')}/content`
}

/**
 * The two one-click ways to a first course, shared by the dashboard's first
 * course panel and the launch plan's first step: a ready-made draft from the
 * goal's template (opens in the editor), or the AI course builder.
 */
export function useFirstCourse(surface: 'home_hero' | 'launch_plan') {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const builderOn = useAIFeature('course_builder')
  const canUseAI = org?.config?.config?.resolved_features?.ai?.enabled === true && builderOn
  const [busy, setBusy] = React.useState<'template' | null>(null)
  const [aiOpen, setAiOpen] = React.useState(false)

  const startTemplate = async () => {
    if (!org?.id || busy) return
    setBusy('template')
    track(AnalyticsEvent.CourseCreationTypeSelected, { creation_type: 'template', source: surface })
    try {
      const { course_uuid } = await createFirstCourse(token, org.id)
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      router.push(getUriWithOrg(org.slug, courseEditorPath(course_uuid)))
    } catch (e: any) {
      const detail = e?.detail
      toast.error(typeof detail === 'string' ? detail : detail?.message ?? t('common.something_went_wrong'))
      setBusy(null)
    }
  }

  const startAI = () => {
    track(AnalyticsEvent.CourseCreationTypeSelected, { creation_type: 'ai', source: surface })
    setAiOpen(true)
  }

  const close = () => {
    setAiOpen(false)
    queryClient.invalidateQueries({ queryKey: ['courses'] })
  }
  const aiModal =
    aiOpen && org?.id ? (
      COURSE_BUILDER_AVAILABLE ? (
        <CourseBuilderModal isOpen onClose={close} orgId={org.id} orgslug={org.slug} accessToken={token as string} />
      ) : (
        <AICourseCreationModal isOpen onClose={close} orgId={org.id} orgslug={org.slug} accessToken={token as string} />
      )
    ) : null

  return { canUseAI, busy, startTemplate, startAI, aiModal }
}
