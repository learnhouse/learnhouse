'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { EnvelopeSimple, Megaphone, Plus, Seal, Users } from '@phosphor-icons/react'
import { Button, DashPage, EmptyState, Panel, SearchInput, SubTabPanel, SubTabs, formatRelative, recipes } from '@/design'
import { listCampaigns, opsKeys, type Campaign, type EmailTemplate } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, useListKeyboard, usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, ListSkeleton, NoAccess, QueryError } from '@components/Admin/Shared/AdminKit'
import { IconTile, useUrlTab } from '@components/Admin/Shared/OpsKit'
import { CampaignStatusPill, CategoryChip, useTemplates } from './emailUi'
import TemplateEditor from './TemplateEditor'
import CampaignDrawer from './CampaignDrawer'

// Org emails (§11.3): reusable templates and campaigns to many orgs at once.
// Tabs, the open template and the open campaign all live in the URL.

const TABS = ['templates', 'campaigns'] as const
type Tab = (typeof TABS)[number]

const TEMPLATE_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_8rem_minmax(0,1.6fr)_7rem] gap-x-4'
const CAMPAIGN_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.5fr)_7rem_8rem_minmax(0,1.2fr)_7rem] gap-x-4'

export default function EmailsPage() {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const [tab, setTab, values, setValues] = useUrlTab<Tab>(TABS, 'templates', ['template', 'campaign', 'q'])
  const allowed = me.can('emails.send')

  if (!me.isLoading && !allowed) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.emails.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const primary =
    tab === 'templates' ? (
      <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setValues({ template: 'new' })}>
        {t('admin.emails.new_template')}
      </Button>
    ) : (
      <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setValues({ campaign: 'new' })}>
        {t('admin.emails.new_campaign')}
      </Button>
    )

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.emails.title')}
        subtitle={t('admin.emails.subtitle')}
        actions={
          <>
            <CopyLinkButton label="" />
            {primary}
          </>
        }
      />
      <SubTabs
        items={[
          { key: 'templates' as const, label: t('admin.emails.tab_templates'), icon: <EnvelopeSimple size={15} className="text-sky-600" /> },
          { key: 'campaigns' as const, label: t('admin.emails.tab_campaigns'), icon: <Megaphone size={15} className="text-violet-600" /> },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('admin.emails.title')}
      >
        <SubTabPanel tab="templates" unmountWhenHidden>
          <TemplatesTab
            q={values.q ?? ''}
            onQ={(v) => setValues({ q: v || undefined }, { replace: true })}
            openId={values.template ?? null}
            onOpen={(id) => setValues({ template: id ?? undefined })}
          />
        </SubTabPanel>
        <SubTabPanel tab="campaigns" unmountWhenHidden>
          <CampaignsTab openId={values.campaign ?? null} onOpen={(id) => setValues({ campaign: id ?? undefined })} />
        </SubTabPanel>
      </SubTabs>
    </DashPage>
  )
}

function TemplatesTab({ q, onQ, openId, onOpen }: { q: string; onQ: (_v: string) => void; openId: string | null; onOpen: (_id: string | null) => void }) {
  const { t, i18n } = useTranslation()
  const { templates, isLoading, error, refetch } = useTemplates()
  const [draft, setDraft] = React.useState(q)
  React.useEffect(() => {
    const id = setTimeout(() => draft !== q && onQ(draft.trim()), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const needle = q.toLowerCase()
  const list = templates.filter((x) => !needle || x.name.toLowerCase().includes(needle) || x.subject.toLowerCase().includes(needle))
  const kb = useListKeyboard(list, (x) => onOpen(x.template_uuid))
  const open: EmailTemplate | null = openId && openId !== 'new' ? templates.find((x) => x.template_uuid === openId) ?? null : null

  return (
    <div className="space-y-4">
      <SearchInput className="xl:max-w-md" value={draft} onChange={setDraft} placeholder={t('admin.emails.search_templates')} />
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<EnvelopeSimple size={22} />}
            title={q ? t('admin.emails.no_template_match') : t('admin.emails.no_templates')}
            description={q ? t('admin.emails.no_match_desc') : t('admin.emails.no_templates_desc')}
            action={
              q ? undefined : (
                <Button size="sm" variant="primary" icon={<Plus size={12} weight="bold" />} onClick={() => onOpen('new')}>
                  {t('admin.emails.new_template')}
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <Panel divided>
          <div className={`${recipes.tableHead} hidden md:grid ${TEMPLATE_GRID}`}>
            <span>{t('admin.emails.name')}</span>
            <span>{t('admin.emails.category_label')}</span>
            <span>{t('admin.emails.subject')}</span>
            <span>{t('admin.emails.updated')}</span>
          </div>
          {list.map((x, i) => (
            <div
              key={x.template_uuid}
              {...kb.rowProps(i)}
              onClick={() => onOpen(x.template_uuid)}
              className={`${TEMPLATE_GRID} items-center gap-y-1 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <IconTile icon={<EnvelopeSimple size={15} />} tone="sky" size="sm" />
                <button type="button" onClick={() => onOpen(x.template_uuid)} className="truncate text-sm font-semibold text-neutral-900 hover:underline underline-offset-2 text-start">
                  {x.name}
                </button>
              </span>
              <span className="justify-self-end md:justify-self-start">
                <CategoryChip category={x.category} />
              </span>
              <span className="col-span-2 md:col-span-1 ps-10 md:ps-0 truncate text-xs md:text-sm text-neutral-500">{x.subject}</span>
              <span className="hidden md:block text-xs text-neutral-400">{formatRelative(x.updated_at ?? null, i18n.language)}</span>
            </div>
          ))}
        </Panel>
      )}
      <TemplateEditor templateId={openId} template={open} canEdit onClose={() => onOpen(null)} />
    </div>
  )
}

function CampaignsTab({ openId, onOpen }: { openId: string | null; onOpen: (_id: string | null) => void }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const { templates } = useTemplates()
  const q = useQuery({
    queryKey: opsKeys.campaigns(),
    queryFn: () => listCampaigns(token),
    enabled: !!token,
    retry: shouldRetry,
    refetchInterval: (query) => (Array.isArray(query.state.data) && query.state.data.some((c) => c.status === 'sending') ? 10_000 : false),
  })
  const list: Campaign[] = Array.isArray(q.data) ? q.data : []
  const kb = useListKeyboard(list, (c) => onOpen(c.campaign_uuid))

  return (
    <div className="space-y-4">
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Megaphone size={22} />}
            title={t('admin.emails.no_campaigns')}
            description={t('admin.emails.no_campaigns_desc')}
            action={
              <Button size="sm" variant="primary" icon={<Plus size={12} weight="bold" />} onClick={() => onOpen('new')}>
                {t('admin.emails.new_campaign')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel divided>
          <div className={`${recipes.tableHead} hidden md:grid ${CAMPAIGN_GRID}`}>
            <span>{t('admin.emails.campaign')}</span>
            <span>{t('admin.emails.status_label')}</span>
            <span>{t('admin.emails.recipients_title')}</span>
            <span>{t('admin.emails.stats')}</span>
            <span>{t('admin.emails.updated')}</span>
          </div>
          {list.map((c, i) => {
            const tpl = templates.find((x) => x.template_uuid === c.template_uuid)
            const s = c.stats ?? {}
            const n = (k: string) => Number(s[k] ?? 0) || 0
            const skipped = Object.keys(s)
              .filter((k) => k.startsWith('skipped'))
              .reduce((a, k) => a + n(k), 0)
            return (
              <div
                key={c.campaign_uuid}
                {...kb.rowProps(i)}
                onClick={() => onOpen(c.campaign_uuid)}
                className={`${CAMPAIGN_GRID} items-center gap-y-1 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <IconTile icon={<Megaphone size={15} />} tone="violet" size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900">{c.name}</span>
                    <span className="block truncate text-xs text-neutral-400">{tpl?.name ?? t('admin.emails.template_missing')}</span>
                  </span>
                </span>
                <span className="justify-self-end md:justify-self-start flex flex-col items-end md:items-start gap-1">
                  <CampaignStatusPill status={c.status} />
                  {c.approved_at && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                      <Seal size={11} weight="fill" />
                      {t('admin.emails.approved')}
                    </span>
                  )}
                </span>
                <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-neutral-600">
                  <Users size={13} className="text-neutral-400" />
                  {t(`admin.emails.recipients.${c.recipients}`, { defaultValue: c.recipients })}
                </span>
                <span className="col-span-2 md:col-span-1 ps-10 md:ps-0 flex flex-wrap gap-x-3 text-xs tabular-nums text-neutral-500">
                  {n('targeted') > 0 ? (
                    <>
                      <span>{t('admin.emails.stat_targeted', { count: n('targeted') })}</span>
                      <span className="text-emerald-600">{t('admin.emails.stat_sent', { count: n('sent') })}</span>
                      {n('failed') > 0 && <span className="text-rose-600">{t('admin.emails.stat_failed', { count: n('failed') })}</span>}
                      {skipped > 0 && <span className="text-amber-600">{t('admin.emails.stat_skipped', { count: skipped })}</span>}
                    </>
                  ) : (
                    <span className="text-neutral-400">{c.scheduled_at ? t('admin.emails.scheduled_on', { date: formatRelative(c.scheduled_at, i18n.language) }) : '–'}</span>
                  )}
                </span>
                <span className="hidden md:block text-xs text-neutral-400">{formatRelative(c.updated_at ?? null, i18n.language)}</span>
              </div>
            )
          })}
        </Panel>
      )}
      <CampaignDrawer campaignId={openId} onClose={() => onOpen(null)} onOpen={(id) => onOpen(id)} />
    </div>
  )
}
