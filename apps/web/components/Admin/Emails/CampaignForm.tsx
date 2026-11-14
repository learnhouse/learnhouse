'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { BookmarkSimple, FloppyDisk, Funnel, Info } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, SegmentedControl } from '@/design'
import { errorMessage, listSavedViews } from '@services/ee/platform/api'
import { createCampaign, opsKeys, updateCampaign, type Campaign, type CampaignRecipients } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import FilterBar, { type FilterValues } from '@components/Admin/Shared/FilterBar'
import { filtersToValues, useAudienceDefs, valuesToFilters } from './audience'
import { CategoryChip, useTemplates } from './emailUi'

// The campaign draft: name, template, audience (org filters or a saved view)
// and who in each org receives it. Saving keeps it a draft; sending happens
// from the campaign drawer after a preview.

interface SavedView {
  view_uuid: string
  name: string
  shared?: boolean
  filters?: Record<string, unknown>
}

export default function CampaignForm({
  campaign,
  onSaved,
  onCancel,
}: {
  campaign?: Campaign | null
  onSaved: (c: Campaign) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const defs = useAudienceDefs()
  const { templates, isLoading: templatesLoading } = useTemplates()
  const [name, setName] = React.useState(campaign?.name ?? '')
  const [templateUuid, setTemplateUuid] = React.useState(campaign?.template_uuid ?? '')
  const [mode, setMode] = React.useState<'filters' | 'view'>(campaign?.audience?.saved_view_uuid ? 'view' : 'filters')
  const [values, setValues] = React.useState<FilterValues>(() => filtersToValues(campaign?.audience))
  const [viewUuid, setViewUuid] = React.useState(campaign?.audience?.saved_view_uuid ?? '')
  const [recipients, setRecipients] = React.useState<CampaignRecipients>((campaign?.recipients as CampaignRecipients) || 'admins')
  const [busy, setBusy] = React.useState(false)

  const views = useQuery({
    queryKey: ['platform', 'saved-views', 'organizations'],
    queryFn: () => listSavedViews(token, 'organizations'),
    enabled: !!token,
    retry: shouldRetry,
  })
  const viewList = (Array.isArray(views.data) ? views.data : []) as SavedView[]
  const template = templates.find((x) => x.template_uuid === templateUuid)
  const filters = valuesToFilters(values)
  const filterCount = Object.keys(filters).length
  const allMembersBlocked = recipients === 'all_members' && !!template && template.category !== 'transactional'
  const valid = !!name.trim() && !!templateUuid && (mode === 'filters' || !!viewUuid) && !allMembersBlocked

  const save = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const audience = mode === 'view' ? { filters: {}, saved_view_uuid: viewUuid } : { filters }
      const body = { name: name.trim(), template_uuid: templateUuid, audience, recipients }
      const saved = campaign ? await updateCampaign(token, campaign.campaign_uuid, body) : await createCampaign(token, body)
      toast.success(campaign ? t('admin.emails.campaign_saved') : t('admin.emails.campaign_created'))
      qc.invalidateQueries({ queryKey: opsKeys.campaigns() })
      onSaved(saved)
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }

  const onFilters = (updates: FilterValues) =>
    setValues((prev) => {
      const next = { ...prev, ...updates }
      for (const k of Object.keys(next)) if (!next[k]) delete next[k]
      return next
    })

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>{t('admin.emails.campaign_name')}</FieldLabel>
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('admin.emails.campaign_name_placeholder')} />
        </div>
        <div>
          <FieldLabel hint={template ? <CategoryChip category={template.category} /> : undefined}>{t('admin.emails.template')}</FieldLabel>
          <select className={INPUT} value={templateUuid} onChange={(e) => setTemplateUuid(e.target.value)}>
            <option value="">{templatesLoading ? t('common.loading') : t('admin.emails.pick_template')}</option>
            {templates.map((tp) => (
              <option key={tp.template_uuid} value={tp.template_uuid}>
                {tp.name}
              </option>
            ))}
          </select>
          {!templatesLoading && templates.length === 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              {t('admin.emails.no_templates_hint')}{' '}
              <Link href="/admin/emails?template=new" className="font-semibold text-neutral-900 hover:underline">
                {t('admin.emails.new_template')}
              </Link>
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-neutral-800">{t('admin.emails.audience_title')}</p>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            ariaLabel={t('admin.emails.audience_title')}
            options={[
              { key: 'filters', label: t('admin.emails.audience_filters') },
              { key: 'view', label: t('admin.emails.audience_view') },
            ]}
          />
        </div>
        {mode === 'filters' ? (
          <>
            <FilterBar values={values} onChange={onFilters} defs={defs} search={{ key: 'q', placeholder: t('admin.emails.audience_search') }} pageKey="__page" />
            <p className="flex items-start gap-1.5 text-xs text-neutral-500">
              <Funnel size={13} className="mt-px shrink-0" />
              {filterCount === 0 ? t('admin.emails.audience_everyone') : t('admin.emails.audience_count', { count: filterCount })}
            </p>
          </>
        ) : (
          <div>
            <select className={INPUT} value={viewUuid} onChange={(e) => setViewUuid(e.target.value)} aria-label={t('admin.emails.audience_view')}>
              <option value="">{views.isLoading ? t('common.loading') : t('admin.emails.pick_view')}</option>
              {viewList.map((v) => (
                <option key={v.view_uuid} value={v.view_uuid}>
                  {v.name}
                  {v.shared ? ` · ${t('admin.filters.shared')}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-neutral-500">
              <BookmarkSimple size={13} className="mt-px shrink-0" />
              {viewList.length === 0 && !views.isLoading ? t('admin.emails.no_views') : t('admin.emails.view_hint')}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-neutral-800">{t('admin.emails.recipients_title')}</p>
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            value={recipients}
            onChange={setRecipients}
            ariaLabel={t('admin.emails.recipients_title')}
            options={(['admins', 'owners', 'all_members'] as CampaignRecipients[]).map((r) => ({ key: r, label: t(`admin.emails.recipients.${r}`) }))}
          />
        </div>
        <p className="text-xs text-neutral-500">{t(`admin.emails.recipients_desc.${recipients}`)}</p>
        {allMembersBlocked && (
          <p className="text-xs font-medium text-rose-600" role="alert">
            {t('admin.emails.all_members_transactional')}
          </p>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs text-sky-700">
        <Info size={14} className="mt-px shrink-0" />
        {t('admin.emails.approval_rule')}
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>{t('common.cancel')}</Button>}
        <Button type="submit" variant="primary" icon={<FloppyDisk size={14} />} disabled={!valid} loading={busy}>
          {campaign ? t('admin.emails.save_draft') : t('admin.emails.create_draft')}
        </Button>
      </div>
    </form>
  )
}
