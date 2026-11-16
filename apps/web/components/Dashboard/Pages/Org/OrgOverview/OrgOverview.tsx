'use client'
// Settings → Overview, the first tab: the organization at a glance. A small
// identity header (logo, name, address, created) with links to the other
// tabs, then the plan, any POC, usage and features (OrgEditPlanUsage).
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, Buildings, Code, List, Palette, TextAlignLeft, Warning } from '@phosphor-icons/react'
import { Panel } from '@/design'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { AIMarkIcon } from '@components/Objects/AI/AIBrand'
import OrgEditPlanUsage from '@components/Dashboard/Pages/Org/OrgEditPlanUsage/OrgEditPlanUsage'

const O = 'dashboard.organization.overview'

const LINKS: { key: string; tab: string; icon: React.ReactNode }[] = [
  { key: 'general', tab: 'general', icon: <TextAlignLeft size={15} /> },
  { key: 'branding', tab: 'branding', icon: <Palette size={15} /> },
  { key: 'menu', tab: 'menu', icon: <List size={15} /> },
  { key: 'ai', tab: 'ai', icon: <AIMarkIcon size={15} /> },
  { key: 'other', tab: 'other', icon: <Code size={15} /> },
  { key: 'danger', tab: 'danger', icon: <Warning size={15} /> },
]

const noop = () => () => {}

function createdOn(value: string | undefined, locale: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function OrgIdentityHeader() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  // The address this org is served on; empty while rendering on the server.
  const host = React.useSyncExternalStore(noop, () => window.location.host, () => '')
  const logo = org?.logo_image ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) : null
  const created = createdOn(org?.creation_date, i18n.language)
  const base = getUriWithOrg(org?.slug ?? '', '') + '/dash/org/settings'
  const publicUrl = getUriWithOrg(org?.slug ?? '', '/')

  return (
    <Panel padded className="flex flex-col gap-4" data-testid="overview-identity">
      <div className="flex items-center gap-4 min-w-0">
        <div data-lh-user-content className="w-14 h-14 rounded-2xl bg-white overflow-hidden flex items-center justify-center shrink-0 ring-1 ring-inset ring-neutral-900/5">
          {logo ? (
            <img src={logo} alt="" className="w-full h-full object-contain" />
          ) : (
            <Buildings size={22} className="text-neutral-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-neutral-900 truncate" dir="auto">
            {org?.name}
          </h2>
          <p className="text-sm text-neutral-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
            {host && (
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-neutral-800 truncate" dir="ltr" title={t(`${O}.public_site`)}>
                {host}
                <ArrowSquareOut size={12} />
              </a>
            )}
            {host && created && <span aria-hidden="true">·</span>}
            {created && <span>{t(`${O}.created`, { date: created })}</span>}
          </p>
        </div>
      </div>
      <nav aria-label={t(`${O}.quick_links`)} className="flex flex-wrap gap-2 pt-4 border-t border-neutral-100">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={`${base}/${l.tab}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100/80 hover:bg-neutral-200/70 hover:text-neutral-900 transition-colors"
            data-quick-link={l.key}
          >
            <span className="text-neutral-400">{l.icon}</span>
            {t(`${O}.links.${l.key}`)}
          </Link>
        ))}
      </nav>
    </Panel>
  )
}

export default function OrgOverview() {
  return (
    <div className="flex flex-col gap-5">
      <OrgIdentityHeader />
      <OrgEditPlanUsage />
    </div>
  )
}
