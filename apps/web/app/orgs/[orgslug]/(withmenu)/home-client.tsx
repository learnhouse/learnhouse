'use client'
import React from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CloudSlash, PaintBrushBroad } from '@phosphor-icons/react'
import Link from 'next/link'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useOrg } from '@components/Contexts/OrgContext'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import RequiredTrainingSection from '@ee/components/HR/Training/RequiredTrainingSection'
import { usePublicLandingPage } from '@components/LandingPages/public/publicQuery'
import { LandingSkeleton } from '@components/LandingPages/public/LandingSkeleton'
import { useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { landingCoursesQuery, lazyBlockGroups } from '@components/LandingPages/render/blockQueries'

// The org home is a page builder page. Before an org publishes its own, the
// API serves its converted classic landing or the default template.
const BuilderLanding = dynamic(() => import('@components/LandingPages/public/BuilderLanding'), {
  loading: () => <LandingSkeleton />,
})
const loadBuilderLanding = () => import('@components/LandingPages/public/BuilderLanding')

function HomeUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <CloudSlash size={32} className="text-neutral-300" />
      <h1 className="text-lg font-semibold text-neutral-700">{t('landingBuilder.public.unavailable_title')}</h1>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        <ArrowClockwise size={15} weight="bold" />
        {t('landingBuilder.public.unavailable_retry')}
      </button>
    </div>
  )
}

/** Admins on a home page nobody designed yet: a quiet way into the Website area. */
function DesignHomePill() {
  const { t } = useTranslation()
  return (
    <Link
      href="/dash/website"
      className="fixed bottom-[calc(var(--lh-mobile-nav-h,0px)+1rem)] end-4 z-30 inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5"
      data-testid="design-home-pill"
    >
      <PaintBrushBroad size={15} weight="duotone" />
      {t('website.design_home')}
    </Link>
  )
}

export default function HomeClient({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any
  // A preview link (?landing_preview=<token>) opened from the builder shows the draft.
  const preview = useSearchParams()?.get('landing_preview') || null
  // Start fetching the page now, while the renderer's chunk downloads.
  const page = usePublicLandingPage(orgslug, '', preview)
  // A stale preview link falls back to the live home page.
  const stalePreview = !!preview && page.isError
  const live = usePublicLandingPage(orgslug, '', null, stalePreview)
  const current = stalePreview ? live : page

  // The page document names its blocks: start the course list and the lazy
  // block chunks now, alongside the renderer's download, rather than one after
  // the other once each piece has rendered.
  // The renderer is only mounted once the org and the page are in, but its
  // chunk can download meanwhile.
  React.useEffect(() => {
    loadBuilderLanding().catch(() => {})
  }, [])
  const queryClient = useQueryClient()
  const session = useLHSession() as any
  const sessionStatus: string | undefined = session?.status
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const doc = current.data?.doc
  const { isAdmin } = useAdminStatus() as any
  React.useEffect(() => {
    if (!doc || sessionStatus === 'loading') return
    const groups = lazyBlockGroups(doc)
    if (groups.data) import('@components/LandingPages/render/dataBlocks').catch(() => {})
    if (groups.forms) import('@components/LandingPages/render/formBlocks').catch(() => {})
    if (groups.rich) import('@components/LandingPages/render/richBlocks').catch(() => {})
    if (groups.courses) queryClient.prefetchQuery(landingCoursesQuery(orgslug, accessToken))
  }, [doc, sessionStatus, accessToken, orgslug, queryClient])

  // Organization/WebSite structured data comes from the server `@seo` slot.
  return (
    <div className="w-full">
      <ListShortcuts />
      {/* The member's required training (EE; renders nothing otherwise). */}
      <RequiredTrainingSection orgslug={orgslug} />
      {!org ? (
        <LandingSkeleton />
      ) : current.isError ? (
        <HomeUnavailable onRetry={() => current.refetch()} />
      ) : current.data ? (
        <>
          <BuilderLanding orgslug={orgslug} preview={stalePreview ? null : preview} initial={current.data} />
          {isAdmin && current.data.mode === 'fallback' && <DesignHomePill />}
        </>
      ) : (
        <LandingSkeleton />
      )}
    </div>
  )
}
