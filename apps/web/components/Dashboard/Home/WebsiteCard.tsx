'use client'
/**
 * Dashboard home: the org's website at a glance. Before the home page is
 * designed it invites the admin to pick a template ("Design your homepage");
 * afterwards it shows the publish state and a way back into the builder.
 * Reads only the small site summary, never the page builder itself.
 */
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Globe, Swatches } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Chip, SectionCard, buttonClass, formatRelative } from '@/design'
import { getLandingSite, landingQueryKeys } from '@services/landing/landing'

export default function WebsiteCard() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { data: site } = useQuery({ queryKey: landingQueryKeys.site(org?.id), queryFn: () => getLandingSite(org.id, token), enabled: !!org?.id && !!token, staleTime: 60_000 })
  const home = site?.pages.find((p) => p.is_home)
  if (!site || !home) return null
  if (!home.published) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-white p-5 nice-shadow" data-testid="home-website-card">
        <div aria-hidden className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full bg-amber-100/70 blur-2xl" />
        <div className="relative flex flex-col gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Swatches size={18} weight="duotone" /></span>
          <div>
            <h3 className="text-[15px] font-semibold text-neutral-900">{t('website.home_card.design_title')}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">{t('website.home_card.design_text')}</p>
          </div>
          <Link href="/dash/website" className={`${buttonClass('primary', 'sm')} self-start`} data-testid="home-design-homepage">
            {t('website.design_home')} <ArrowRight size={13} className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    )
  }
  return (
    <SectionCard
      icon={<Globe size={18} className="text-sky-600" />}
      title={t('website.title')}
      actions={<Link href="/dash/website" className={buttonClass('ghost', 'sm')}>{t('website.home_card.open')} <ArrowRight size={13} className="rtl:rotate-180" /></Link>}
    >
      <div className="flex flex-col gap-2" data-testid="home-website-card">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="emerald">{t('landingBuilder.card.live', { version: home.published_version })}</Chip>
          {home.has_unpublished_changes && <Chip tone="amber">{t('landingBuilder.card.unpublished_changes')}</Chip>}
        </div>
        <p className="text-[13px] text-neutral-500">{t('website.home_card.pages', { count: site.pages.length })} · {t('website.status.live_since', { when: formatRelative(home.published_at || '', i18n.language) })}</p>
      </div>
    </SectionCard>
  )
}
