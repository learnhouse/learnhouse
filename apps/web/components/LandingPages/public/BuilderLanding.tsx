'use client'
/**
 * A published builder page on the public site (the org home, or /p/<slug>).
 * With `preview` (a page's preview token) it shows the draft instead, with a
 * small bar saying so. Client-rendered, like every public org page.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Eye } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import type { PublicLandingPage } from '@services/landing/landing'
import { usePublicLandingPage } from './publicQuery'
import { asDoc } from '../model/types'
import LandingRenderer from '../render/LandingRenderer'
import { LandingSkeleton } from './LandingSkeleton'

export { LandingSkeleton }

export default function BuilderLanding({
  orgslug,
  slug = '',
  preview,
  fallback = null,
  initial,
}: {
  orgslug: string
  slug?: string
  preview?: string | null
  /** Shown when there is no published page (or the preview link is wrong). */
  fallback?: React.ReactNode
  initial?: PublicLandingPage
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const query = usePublicLandingPage(orgslug, slug, preview, !initial)
  const page = initial || query.data
  const doc = React.useMemo(() => (page ? asDoc(page.doc) : null), [page])

  React.useEffect(() => {
    // Extra pages name the tab after themselves (the home keeps the org title).
    if (slug && page?.title && typeof document !== 'undefined') document.title = `${doc?.page?.title || page.title} | ${org?.name || ''}`
  }, [slug, page?.title, doc?.page?.title, org?.name])

  if (!page) return query.isError ? <>{fallback}</> : <LandingSkeleton />
  if (!doc || !org) return <LandingSkeleton />
  return (
    <>
      {page.mode === 'preview' && (
        <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white">
          <Eye size={15} weight="bold" />
          {t('landingBuilder.public.preview_bar')}
        </div>
      )}
      <LandingRenderer
        doc={doc}
        mode="public"
        orgslug={orgslug}
        org={org}
        session={session?.status ?? 'loading'}
        accessToken={session?.data?.tokens?.access_token}
        pageSlug={page.slug}
      />
    </>
  )
}
