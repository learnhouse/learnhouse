'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChartBar, GearSix, WarningCircle } from '@phosphor-icons/react'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useResolvedFeature } from '@components/Hooks/useResolvedFeature'
import { Button, EmptyState, Panel, Skeleton, SubTabPanel, SubTabs, useSubTab } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { fetchPeerReviewSettings } from '@services/courses/peerReviewAdmin'
import { defaultPrompts, normalizeSettings } from '@/lib/assignments/peerReviewRubric'
import PeerReviewSetup from '../_components/PeerReview/PeerReviewSetup'
import PeerReviewMonitor from '../_components/PeerReview/PeerReviewMonitor'

// ?subpage=peer-review: set peer review up (Setup) and follow the round
// (Monitor). Peer review never writes grades; the Monitor only suggests one.

const VIEWS = ['setup', 'monitor'] as const
type View = (typeof VIEWS)[number]

export default function AssignmentPeerReviewSubPage() {
  const { t } = useTranslation()
  const ctx = useAssignments() as any
  const assignment = ctx?.assignment_object
  const assignmentUuid: string | undefined = assignment?.assignment_uuid
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const userKey = String(session?.data?.user?.id ?? session?.data?.user?.user_uuid ?? 'anon')
  const gate = useResolvedFeature('peer_review', { allowWhenDisabled: true })
  const [view, setView] = useSubTab<View>('setup', VIEWS, { param: 'view', rememberAs: 'assignment-peer-review:view' })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.peerReview.settings(assignmentUuid ?? ''),
    queryFn: async () => {
      try {
        return await fetchPeerReviewSettings(assignmentUuid as string, accessToken)
      } catch (e: any) {
        // No settings row yet: start from the defaults.
        if (e?.status === 404) return null
        throw e
      }
    },
    enabled: !!(assignmentUuid && accessToken),
  })

  const settings = React.useMemo(() => normalizeSettings(data), [data])
  const prompts = React.useMemo(() => settings.prompts ?? defaultPrompts((k) => t(k)), [settings.prompts, t])

  const body = () => {
    if (!assignmentUuid || isLoading) {
      return (
        <div className='flex flex-col gap-4'>
          <Skeleton className='h-24 w-full rounded-2xl' />
          <Skeleton className='h-64 w-full rounded-2xl' />
        </div>
      )
    }
    if (isError) {
      return (
        <Panel>
          <EmptyState
            icon={<WarningCircle size={22} />}
            title={t('peer_review.instructor.error_title')}
            description={(error as any)?.message || t('peer_review.instructor.error_description')}
            action={<Button size='sm' onClick={() => refetch()}>{t('peer_review.instructor.retry')}</Button>}
          />
        </Panel>
      )
    }
    return (
      <SubTabs
        ariaLabel={t('peer_review.instructor.tab')}
        value={view}
        onChange={setView}
        idPrefix='peer-review-view'
        items={[
          { key: 'setup', label: t('peer_review.instructor.setup'), icon: <GearSix size={15} /> },
          { key: 'monitor', label: t('peer_review.instructor.monitor.title'), icon: <ChartBar size={15} /> },
        ]}
      >
        <SubTabPanel tab='setup'>
          <PeerReviewSetup key={JSON.stringify(data ?? null)} assignmentUuid={assignmentUuid} settings={settings} locked={(data as any)?.feature_available === false || (!gate.loading && gate.reason === 'plan')} userKey={userKey} />
        </SubTabPanel>
        <SubTabPanel tab='monitor'>
          <PeerReviewMonitor
            assignmentUuid={assignmentUuid}
            settings={settings}
            prompts={prompts}
            ungraded={!!assignment?.ungraded}
            onGoToSetup={() => setView('setup')}
          />
        </SubTabPanel>
      </SubTabs>
    )
  }

  return (
    <div className='flex flex-col w-full min-w-0 lg:h-full lg:overflow-y-auto'>
      <div className='w-full px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 pb-10 flex flex-col gap-4'>{body()}</div>
    </div>
  )
}
