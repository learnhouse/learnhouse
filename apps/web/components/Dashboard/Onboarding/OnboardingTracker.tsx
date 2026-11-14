'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { onboardingKeys } from '@services/onboarding/onboarding'
import InviteDialog, { type InviteTab } from '@components/Onboarding/InviteDialog'
import FirstPublishCelebration from '@components/Onboarding/FirstPublishCelebration'
import { onOpenInviteDialog, openInviteDialog } from '@components/Onboarding/onboardingEvents'

/**
 * Mounted once across the dashboard. Keeps the setup checklist fresh as the
 * admin moves around (the server reads completion from the org's data),
 * celebrates steps as they finish (the first published course gets its own
 * moment), and hosts the invite dialog for every page.
 */
export default function OnboardingTracker() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const { loaded, uncelebrated, markCelebrated, recordEvent, invitesGate } = useOnboarding()
  const [invite, setInvite] = useState<{ open: boolean; tab: InviteTab }>({ open: false, tab: 'link' })
  const [celebrate, setCelebrate] = useState(false)
  const firstPath = useRef(true)

  // A course published or a logo uploaded on another page: re-read the
  // checklist when the admin navigates (cheap, one request).
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false
      return
    }
    if (org?.id) queryClient.invalidateQueries({ queryKey: onboardingKeys.state(org.id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => onOpenInviteDialog((tab) => setInvite({ open: true, tab })), [])

  const pending = uncelebrated.join(',')
  useEffect(() => {
    if (!loaded || !pending) return
    const ids = pending.split(',')
    for (const id of ids) track(AnalyticsEvent.OnboardingStepCompleted, { step_id: id })
    if (ids.includes('publish_course')) setCelebrate(true)
    const others = ids.filter((id) => id !== 'publish_course')
    if (others.length) {
      toast.success(
        t('onboarding.step_completed_toast', { steps: others.map((id) => t(`onboarding.steps.${id}.title`)).join(', ') }),
        { id: 'onboarding-done' },
      )
      markCelebrated(others)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pending])

  const closeCelebration = () => {
    setCelebrate(false)
    markCelebrated(['publish_course'])
    track(AnalyticsEvent.OnboardingFirstPublishCelebrated, {})
    recordEvent('first_publish_celebrated')
  }

  if (!org?.id) return null

  return (
    <>
      <InviteDialog
        open={invite.open}
        onOpenChange={(open) => setInvite((i) => ({ ...i, open }))}
        orgId={org.id}
        orgSlug={org.slug}
        initialTab={invite.tab}
        gate={invitesGate}
      />
      <FirstPublishCelebration
        open={celebrate}
        onClose={closeCelebration}
        orgSlug={org.slug}
        orgName={org.name}
        onInvite={() => {
          closeCelebration()
          openInviteDialog('link')
        }}
      />
    </>
  )
}
