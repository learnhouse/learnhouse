'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChartLineUp, EyeSlash, FileText, Heartbeat, ImageSquare, Stack } from '@phosphor-icons/react'
import { Chip, EmptyState, SectionCard, SegmentedControl, StatCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { EditorSkeleton, ErrorNotice } from '@components/Dashboard/Pages/Course/courseEditorUi'
import { ScoreRing } from '@components/Dashboard/Shared/SEO/SeoScoreCard'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getSeoHealth, type SeoHealthItem } from '@services/seo/seo'
import { buildPageTitle, getOrgSeoConfig } from '@/lib/seo/utils'
import { duplicateTitles, effectiveTitle, seoChecks, seoScore, type SeoCheck, type SeoFacts } from '@/lib/seo/score'
import { stripResourcePrefix } from '@/lib/seo/paths'
import { useSeoT } from '@/lib/seo/i18n'

/** Dashboard page that edits each resource's SEO tab. */
function editHref(orgslug: string, item: SeoHealthItem): string {
  const id = stripResourcePrefix(item.resource_type, item.uuid)
  switch (item.resource_type) {
    case 'course':
      return getUriWithOrg(orgslug, `/dash/courses/course/${id}/seo`)
    case 'path':
      return getUriWithOrg(orgslug, `/dash/paths/path/${id}/seo`)
    case 'podcast':
      return getUriWithOrg(orgslug, `/dash/podcasts/podcast/${id}/seo`)
    case 'community':
      return getUriWithOrg(orgslug, `/dash/communities/${id}/seo`)
    default:
      return getUriWithOrg(orgslug, `/dash/library/folder/${id}?seo=1`)
  }
}

type Row = { item: SeoHealthItem; checks: SeoCheck[]; score: number; issues: SeoCheck[]; duplicate: boolean }

/** Every public page of the org with its score and the issues to fix first. */
export function SeoHealthReport() {
  const st = useSeoT()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [filter, setFilter] = useState<'issues' | 'all'>('issues')
  const { data, isLoading, error } = useQuery({
    queryKey: ['seo', 'health', org?.id],
    queryFn: () => getSeoHealth(org.id, token),
    enabled: !!org?.id && !!token,
    staleTime: 30_000,
  })

  const rows: Row[] = useMemo(() => {
    if (!data) return []
    const orgSeo = getOrgSeoConfig(org)
    const items = data.items.filter((i) => i.public && i.published)
    const facts = items.map(
      (item): SeoFacts => ({
        type: item.resource_type,
        name: item.name,
        slug: item.slug,
        description: item.description,
        hasImage: !!item.thumbnail_image,
        seo: item.seo || {},
        titleSuffixLength: item.seo?.title ? 0 : buildPageTitle(item.name, org?.name || '', orgSeo).length - item.name.length,
      }),
    )
    const dupes = duplicateTitles(facts.map((f, i) => ({ uuid: items[i].uuid, title: effectiveTitle(f) })))
    return items
      .map((item, i) => {
        const checks = seoChecks(facts[i])
        const duplicate = dupes.has(item.uuid)
        return {
          item,
          checks,
          score: Math.max(0, seoScore(checks) - (duplicate ? 10 : 0)),
          issues: checks.filter((c) => c.level === 'fail' || c.level === 'warn'),
          duplicate,
        }
      })
      .sort((a, b) => a.score - b.score)
  }, [data, org])

  if (error) return <ErrorNotice>{String((error as any)?.message || 'Error')}</ErrorNotice>
  if (isLoading || !data) return <EditorSkeleton sections={1} rows={4} />

  const shown = filter === 'issues' ? rows.filter((r) => r.issues.length || r.duplicate) : rows
  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0
  const noindexed = rows.filter((r) => r.item.seo?.robots_noindex).length
  const missingDescription = rows.filter((r) => r.checks.some((c) => c.id === 'description_missing')).length
  const missingImage = rows.filter((r) => r.checks.some((c) => c.id === 'image_missing')).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={<ChartLineUp size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={st('org.health_average')} value={`${average}/100`} />
        <StatCard icon={<Stack size={18} />} iconClass="bg-neutral-100 text-neutral-600" label={st('org.health_pages')} value={rows.length} />
        <StatCard icon={<FileText size={18} />} iconClass="bg-amber-50 text-amber-600" label={st('org.health_missing_description')} value={missingDescription} />
        <StatCard icon={<ImageSquare size={18} />} iconClass="bg-sky-50 text-sky-600" label={st('org.health_missing_image')} value={missingImage} />
        <StatCard icon={<EyeSlash size={18} />} iconClass="bg-rose-50 text-rose-600" label={st('org.health_noindexed')} value={noindexed} />
      </div>
      <SectionCard
        icon={<Heartbeat size={18} />}
        title={st('org.health_title')}
        description={st('org.health_subtitle')}
        actions={
          <SegmentedControl
            ariaLabel={st('org.health_title')}
            value={filter}
            options={[
              { key: 'issues', label: st('org.health_filter_issues') },
              { key: 'all', label: st('org.health_filter_all') },
            ]}
            onChange={(v) => v && setFilter(v as 'issues' | 'all')}
          />
        }
        bodyClassName="p-2 sm:p-3"
      >
        {shown.length === 0 ? (
          <EmptyState icon={<Heartbeat size={22} />} title={st('org.health_empty')} />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {shown.map((r) => (
              <li key={r.item.uuid} className="flex items-center gap-3 px-2 sm:px-3 py-3">
                <ScoreRing score={r.score} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-neutral-900 truncate">{r.item.name}</span>
                    <Chip>{st(`org.types.${r.item.resource_type}`)}</Chip>
                    {r.duplicate && <Chip tone="amber">{st('org.health_duplicate')}</Chip>}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500 truncate" dir="ltr">/{r.item.key}</div>
                  {r.issues.length > 0 && (
                    <p className="mt-1 text-xs text-neutral-600 line-clamp-2">
                      {r.issues
                        .slice(0, 3)
                        .map((c) => st(`checks.${c.id}`, c.params))
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <Link
                  href={editHref(org?.slug, r.item)}
                  className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50"
                >
                  {st('org.health_fix')}
                  <ArrowRight size={12} className="rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
