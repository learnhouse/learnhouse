'use client'
import React, { useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowsClockwise,
  BookOpen,
  CheckCircle,
  Eye,
  Key,
  Lifebuoy,
  Lightning,
  Plus,
  Sliders,
  Trash,
} from '@phosphor-icons/react'
import {
  APIToken,
  APITokenCreateRequest,
  APITokenRights,
  createAPIToken,
  getFullRights,
  getReadOnlyRights,
  listAPITokens,
  regenerateAPIToken,
  revokeAPIToken,
} from '@services/api_tokens/api_tokens'
import { getAPIUrl } from '@services/config/config'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  Chip,
  ChoiceCard,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  INPUT,
  SegmentedControl,
  TEXTAREA,
  buttonClass,
  formatRelative,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { buildSnippets } from '@components/Admin/Developers/snippets'
import { CodeBlock, SecretOnce, absoluteApiBase } from '@components/Dashboard/Pages/Org/Developers/devKit'
import APIDocumentation from './APIDocumentation'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

type RightsPreset = 'custom' | 'readonly' | 'full'
type View = 'tokens' | 'docs'
const VIEWS: readonly View[] = ['tokens', 'docs']

const ACTIONS = ['action_create', 'action_read', 'action_update', 'action_delete'] as const
type Action = (typeof ACTIONS)[number]
const ACTION_LETTER: Record<Action, string> = {
  action_create: 'C',
  action_read: 'R',
  action_update: 'U',
  action_delete: 'D',
}

// API token access is restricted to these resources. `search` only has read.
const RESOURCES: { key: keyof APITokenRights; labelKey: string; actions: readonly Action[] }[] = [
  { key: 'courses', labelKey: 'dashboard.organization.api_access.resources.courses', actions: ACTIONS },
  { key: 'activities', labelKey: 'dashboard.organization.api_access.resources.activities', actions: ACTIONS },
  { key: 'assignments', labelKey: 'dashboard.organization.api_access.resources.assignments', actions: ACTIONS },
  { key: 'coursechapters', labelKey: 'dashboard.organization.api_access.resources.chapters', actions: ACTIONS },
  { key: 'folders', labelKey: 'dashboard.organization.api_access.resources.folders', actions: ACTIONS },
  { key: 'media', labelKey: 'dashboard.organization.api_access.resources.media', actions: ACTIONS },
  { key: 'certifications', labelKey: 'dashboard.organization.api_access.resources.certifications', actions: ACTIONS },
  { key: 'usergroups', labelKey: 'dashboard.organization.api_access.resources.user_groups', actions: ACTIONS },
  { key: 'payments', labelKey: 'dashboard.organization.api_access.resources.payments', actions: ACTIONS },
  { key: 'playgrounds', labelKey: 'common.playgrounds', actions: ACTIONS },
  { key: 'newsletter', labelKey: 'dashboard.organization.api_access.resources.newsletter', actions: ACTIONS },
  { key: 'crm', labelKey: 'dashboard.organization.api_access.resources.crm', actions: ['action_read', 'action_update'] },
  { key: 'users', labelKey: 'dashboard.organization.api_access.resources.users_admin', actions: ACTIONS },
  { key: 'roles', labelKey: 'dashboard.organization.api_access.resources.roles_admin', actions: ACTIONS },
  { key: 'search', labelKey: 'common.search', actions: ['action_read'] },
]

const has = (rights: APITokenRights | null | undefined, res: keyof APITokenRights, action: Action) =>
  !!(rights as any)?.[res]?.[action]

// Whether `rights` grants exactly what `template` grants. Tokens created
// before the users/roles/playgrounds/newsletter/crm buckets existed lack them; those are skipped.
function matchesTemplate(rights: APITokenRights, template: APITokenRights) {
  return RESOURCES.every(({ key, actions }) => {
    if ((rights as any)[key] === undefined && (key === 'users' || key === 'roles' || key === 'playgrounds' || key === 'newsletter' || key === 'crm')) return true
    return actions.every((a) => has(rights, key, a) === has(template, key, a))
  })
}

function presetOf(rights: APITokenRights | null | undefined): RightsPreset | null {
  if (!rights) return null
  if (matchesTemplate(rights, getFullRights())) return 'full'
  if (matchesTemplate(rights, getReadOnlyRights())) return 'readonly'
  return 'custom'
}

// Kept outside the component: reading the clock is not a render concern.
const isExpired = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now()

// Datetime-local value ("YYYY-MM-DDTHH:mm") `days` from now, in local time.
function inDays(days: number) {
  const d = new Date(Date.now() + days * 86400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Desktop table: the card is the grid, the header and every row are
// subgrids spanning it, so columns line up across rows.
const TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] lg:gap-x-4'
const ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

const OrgEditAPIAccess: React.FC = () => {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const [view, setView] = useStoredState<View>('lh.dev.api.view', 'tokens', VIEWS)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [viewToken, setViewToken] = useState<APIToken | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<APIToken | null>(null)
  const [regenTarget, setRegenTarget] = useState<APIToken | null>(null)
  // A freshly minted secret: shown once, then gone.
  const [secret, setSecret] = useState<{ value: string; kind: 'created' | 'regenerated'; name: string } | null>(null)

  // Create token form state
  const [tokenName, setTokenName] = useState('')
  const [tokenDescription, setTokenDescription] = useState('')
  const [tokenExpiry, setTokenExpiry] = useState('')
  const [tokenRights, setTokenRights] = useState<APITokenRights>(getReadOnlyRights())
  const [rightsPreset, setRightsPreset] = useState<RightsPreset>('readonly')

  const { data, isLoading } = useQuery<APIToken[]>({
    queryKey: org?.id ? ['org', org.id, 'api-tokens'] : ['api-tokens-disabled'],
    queryFn: () => listAPITokens(org.id, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  })
  const tokens = Array.isArray(data) ? data : []
  const activeCount = tokens.filter((tk) => tk.is_active).length

  const resetForm = () => {
    setTokenName('')
    setTokenDescription('')
    setTokenExpiry('')
    setTokenRights(getReadOnlyRights())
    setRightsPreset('readonly')
  }

  const openCreate = () => {
    resetForm()
    setSecret(null)
    setIsCreateOpen(true)
  }

  const handleCreateToken = async () => {
    if (!tokenName.trim()) {
      toast.error(t('dashboard.organization.api_access.toasts.name_required'))
      return
    }

    setCreating(true)
    const loadingToast = toast.loading(t('dashboard.organization.api_access.toasts.creating'))
    try {
      const body: APITokenCreateRequest = {
        name: tokenName.trim(),
        description: tokenDescription.trim() || null,
        rights: tokenRights,
        expires_at: tokenExpiry || null,
      }

      const response = await createAPIToken(org.id, body, access_token)

      if (response.success) {
        setSecret({ value: response.data.token, kind: 'created', name: body.name })
        track(AnalyticsEvent.ApiTokenCreated, {
          rights_preset: rightsPreset,
          has_expiry: !!tokenExpiry,
        })
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'api-tokens'] })
        toast.success(t('dashboard.organization.api_access.toasts.created'), { id: loadingToast })
        resetForm()
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.api_access.toasts.create_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.api_access.toasts.create_failed'), { id: loadingToast })
    } finally {
      setCreating(false)
    }
  }

  const handleRevokeToken = async () => {
    const target = revokeTarget
    if (!target) return

    const loadingToast = toast.loading(t('dashboard.organization.api_access.toasts.revoking'))
    try {
      const response = await revokeAPIToken(org.id, target.token_uuid, access_token)

      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'api-tokens'] })
        toast.success(t('dashboard.organization.api_access.toasts.revoked'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.api_access.toasts.revoke_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.api_access.toasts.revoke_failed'), { id: loadingToast })
    }
  }

  const handleRegenerateToken = async () => {
    const target = regenTarget
    if (!target) return

    const loadingToast = toast.loading(t('dashboard.organization.api_access.toasts.regenerating'))
    try {
      const response = await regenerateAPIToken(org.id, target.token_uuid, access_token)

      if (response.success) {
        setSecret({ value: response.data.token, kind: 'regenerated', name: target.name })
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'api-tokens'] })
        toast.success(t('dashboard.organization.api_access.toasts.regenerated'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.api_access.toasts.regenerate_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.api_access.toasts.regenerate_failed'), { id: loadingToast })
    }
  }

  const handlePresetChange = (preset: RightsPreset) => {
    setRightsPreset(preset)
    if (preset === 'readonly') setTokenRights(getReadOnlyRights())
    else if (preset === 'full') setTokenRights(getFullRights())
    // Custom starts from whatever the previous preset granted.
  }

  const dateFmt = (value: string | null) => {
    if (!value) return null
    const d = new Date(value)
    if (isNaN(d.getTime())) return value
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(d)
  }

  const closeCreate = () => {
    setIsCreateOpen(false)
    setSecret(null)
  }

  const createdSecret = isCreateOpen && secret?.kind === 'created' ? secret : null
  const tryItSnippets = createdSecret
    ? buildSnippets({
        method: 'GET',
        url: `${absoluteApiBase(getAPIUrl())}courses/org_slug/${org?.slug}/page/1/limit/10`,
        token: createdSecret.value,
      })
    : null

  return (
    <FeatureGate feature="api_access">
      <div className="flex flex-col gap-5">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<View>
            value={view}
            onChange={setView}
            ariaLabel={t('dashboard.organization.api_access.title')}
            options={[
              {
                key: 'tokens',
                label: (
                  <>
                    <Key size={13} />
                    {t('dashboard.organization.api_access.api_tokens')}
                  </>
                ),
                count: isLoading ? undefined : activeCount,
              },
              {
                key: 'docs',
                label: (
                  <>
                    <BookOpen size={13} />
                    {t('dashboard.organization.api_access.docs_playground')}
                  </>
                ),
              },
            ]}
          />
          <div className="flex items-center gap-2">
            <a
              href="mailto:hello@learnhouse.app"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('ghost', 'md', 'max-sm:hidden')}
              title={t('dashboard.organization.api_access.contact_support')}
            >
              <Lifebuoy size={14} />
              {t('dashboard.organization.api_access.something_not_working')}
            </a>
            {view === 'tokens' && (
              <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={openCreate}>
                {t('dashboard.organization.api_access.create_token')}
              </Button>
            )}
          </div>
        </div>

        {view === 'tokens' ? (
          <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
            {(isLoading || tokens.length > 0) && (
              <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
                <span>{t('dashboard.organization.api_access.name')}</span>
                <span>{t('dashboard.organization.api_access.token_prefix')}</span>
                <span>{t('dashboard.developers.api.access')}</span>
                <span>{t('dashboard.organization.api_access.created')}</span>
                <span>{t('dashboard.organization.api_access.last_used')}</span>
                <span>{t('dashboard.organization.api_access.expires')}</span>
                <span className="sr-only">{t('dashboard.organization.api_access.actions')}</span>
              </div>
            )}

            {isLoading ? (
              <div className="animate-pulse divide-y divide-neutral-100 lg:col-span-full">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-neutral-100 rounded w-40" />
                      <div className="h-3 bg-neutral-100 rounded w-56" />
                    </div>
                    <div className="hidden sm:block h-6 w-24 bg-neutral-100 rounded-md" />
                    <div className="hidden sm:block h-6 w-28 bg-neutral-100 rounded-full" />
                  </div>
                ))}
              </div>
            ) : tokens.length === 0 ? (
              <div className="lg:col-span-full">
                <EmptyState
                  icon={<Key size={22} />}
                  title={t('dashboard.organization.api_access.no_tokens_yet')}
                  description={t('dashboard.organization.api_access.tokens_description')}
                  action={
                    <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={openCreate}>
                      {t('dashboard.organization.api_access.create_token')}
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
                {tokens.map((token) => {
                  const expired = isExpired(token.expires_at)
                  const muted = !token.is_active || expired
                  return (
                    <li
                      key={token.token_uuid}
                      className={`group ${ROW_GRID} px-5 py-3.5 flex flex-col gap-2 hover:bg-neutral-50/60 transition-colors`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              !token.is_active ? 'bg-neutral-300' : expired ? 'bg-rose-400' : 'bg-emerald-500'
                            }`}
                            aria-hidden
                          />
                          <button
                            type="button"
                            onClick={() => setViewToken(token)}
                            className={`text-sm font-semibold truncate text-start hover:underline ${muted ? 'text-neutral-400' : 'text-neutral-900'}`}
                          >
                            {token.name}
                          </button>
                          {!token.is_active ? (
                            <Chip>{t('dashboard.organization.api_access.revoked')}</Chip>
                          ) : (
                            expired && <Chip tone="rose">{t('dashboard.developers.api.expired')}</Chip>
                          )}
                        </div>
                        {token.description && (
                          <p className="ps-3.5 mt-0.5 text-xs text-neutral-500 truncate">{token.description}</p>
                        )}
                      </div>
                      <div className="min-w-0">
                        <code dir="ltr" className="inline-block max-w-full truncate font-mono text-[12px] text-neutral-600 bg-neutral-100/80 rounded-md px-1.5 py-0.5">
                          {token.token_prefix}…
                        </code>
                      </div>
                      <div className="min-w-0">
                        <RightsChips rights={token.rights} />
                      </div>
                      <Meta label={t('dashboard.organization.api_access.created')}>
                        {formatRelative(token.creation_date, i18n.language) ?? '—'}
                      </Meta>
                      <Meta label={t('dashboard.organization.api_access.last_used')}>
                        {token.last_used_at ? (
                          formatRelative(token.last_used_at, i18n.language)
                        ) : (
                          <span className="text-neutral-400">{t('dashboard.organization.api_access.never')}</span>
                        )}
                      </Meta>
                      <Meta label={t('dashboard.organization.api_access.expires')}>
                        {token.expires_at ? (
                          <span className={expired ? 'text-rose-600' : ''}>{dateFmt(token.expires_at)}</span>
                        ) : (
                          <span className="text-neutral-400">{t('dashboard.organization.api_access.never')}</span>
                        )}
                      </Meta>
                      <div className="flex items-center gap-0.5 lg:justify-end -ms-1.5 lg:ms-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewToken(token)}
                          aria-label={t('dashboard.organization.api_access.token_details')}
                          title={t('dashboard.organization.api_access.token_details')}
                          icon={<Eye size={15} />}
                        />
                        {token.is_active && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRegenTarget(token)}
                              aria-label={t('dashboard.organization.api_access.regenerate')}
                              title={t('dashboard.organization.api_access.regenerate')}
                              icon={<ArrowsClockwise size={15} />}
                            />
                            <Button
                              variant="danger-ghost"
                              size="icon"
                              onClick={() => setRevokeTarget(token)}
                              aria-label={t('dashboard.organization.api_access.revoke')}
                              title={t('dashboard.organization.api_access.revoke')}
                              icon={<Trash size={15} />}
                            />
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <APIDocumentation />
        )}
      </div>

      {/* Create token */}
      <Modal
        isDialogOpen={isCreateOpen}
        onOpenChange={(open) => (open ? setIsCreateOpen(true) : closeCreate())}
        size="lg"
        // Losing the one-time secret to a stray click would be painful.
        closeOnOutsideClick={!createdSecret}
        preventClose={creating}
        icon={createdSecret ? <CheckCircle size={17} weight="fill" className="text-emerald-500" /> : <Key size={16} />}
        dialogTitle={createdSecret ? t('dashboard.developers.api.token_ready') : t('dashboard.organization.api_access.create_api_token')}
        dialogDescription={
          createdSecret ? createdSecret.name : t('dashboard.organization.api_access.create_token_desc')
        }
        footer={
          createdSecret ? (
            <div className="flex justify-end">
              <Button variant="primary" onClick={closeCreate}>
                {t('dashboard.organization.api_access.done')}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button onClick={closeCreate} disabled={creating}>
                {t('dashboard.organization.api_access.cancel')}
              </Button>
              <Button variant="primary" onClick={handleCreateToken} loading={creating} icon={<Key size={14} />}>
                {t('dashboard.organization.api_access.create_token')}
              </Button>
            </div>
          )
        }
        dialogContent={
          createdSecret ? (
            <div className="flex flex-col gap-5">
              <SecretOnce
                title={t('dashboard.organization.api_access.save_token_warning')}
                hint={t('dashboard.organization.api_access.save_token_hint')}
                label={t('dashboard.organization.api_access.your_api_token')}
                value={createdSecret.value}
              />
              {tryItSnippets && (
                <div>
                  <FieldLabel hint={t('dashboard.developers.api.try_it_hint')}>{t('dashboard.developers.api.try_it')}</FieldLabel>
                  <CodeBlock
                    maxHeight="max-h-[220px]"
                    tabs={[
                      { key: 'curl', label: 'cURL', code: tryItSnippets.curl, lang: 'bash' },
                      { key: 'js', label: 'JavaScript', code: tryItSnippets.js, lang: 'js' },
                      { key: 'python', label: 'Python', code: tryItSnippets.python, lang: 'python' },
                    ]}
                  />
                </div>
              )}
            </div>
          ) : (
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault()
                handleCreateToken()
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <FieldLabel hint={`${tokenName.length}/100`}>{t('dashboard.organization.api_access.token_name_label')}</FieldLabel>
                  <input
                    autoFocus
                    className={INPUT}
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder={t('dashboard.organization.api_access.token_name_placeholder')}
                    maxLength={100}
                  />
                </label>
                <div>
                  <FieldLabel>{t('dashboard.organization.api_access.expiration_label')}</FieldLabel>
                  <input
                    type="datetime-local"
                    className={INPUT}
                    value={tokenExpiry}
                    onChange={(e) => setTokenExpiry(e.target.value)}
                    aria-label={t('dashboard.organization.api_access.expiration_label')}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" title={t('dashboard.organization.api_access.expiration_hint')}>
                    {[
                      { key: 'never', label: t('dashboard.organization.api_access.never'), value: '' },
                      { key: '30', label: t('dashboard.developers.api.days', { count: 30 }), value: inDays(30) },
                      { key: '90', label: t('dashboard.developers.api.days', { count: 90 }), value: inDays(90) },
                      { key: '365', label: t('dashboard.developers.api.one_year'), value: inDays(365) },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setTokenExpiry(opt.value)}
                        className={`h-6 px-2 rounded-md text-[11px] font-semibold transition-colors ${
                          (opt.key === 'never' && !tokenExpiry)
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="block">
                <FieldLabel>{t('dashboard.organization.api_access.description_label')}</FieldLabel>
                <textarea
                  className={`${TEXTAREA} h-16`}
                  value={tokenDescription}
                  onChange={(e) => setTokenDescription(e.target.value)}
                  placeholder={t('dashboard.organization.api_access.description_placeholder')}
                  maxLength={500}
                />
              </label>

              <div>
                <FieldLabel>{t('dashboard.organization.api_access.permissions_label')}</FieldLabel>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup">
                  <ChoiceCard
                    selected={rightsPreset === 'readonly'}
                    onClick={() => handlePresetChange('readonly')}
                    icon={<Eye size={17} />}
                    title={t('dashboard.organization.api_access.read_only')}
                    description={t('dashboard.developers.api.preset_readonly')}
                  />
                  <ChoiceCard
                    selected={rightsPreset === 'full'}
                    onClick={() => handlePresetChange('full')}
                    icon={<Lightning size={17} />}
                    title={t('dashboard.organization.api_access.full_access')}
                    description={t('dashboard.developers.api.preset_full')}
                  />
                  <ChoiceCard
                    selected={rightsPreset === 'custom'}
                    onClick={() => handlePresetChange('custom')}
                    icon={<Sliders size={17} />}
                    title={t('dashboard.organization.api_access.custom')}
                    description={t('dashboard.developers.api.preset_custom')}
                  />
                </div>
                <div className="mt-3">
                  <PermissionsMatrix
                    rights={tokenRights}
                    onChange={rightsPreset === 'custom' ? setTokenRights : undefined}
                  />
                </div>
              </div>
              {/* Lets Enter submit from the name field. */}
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>
          )
        }
      />

      {/* Regenerated secret */}
      <Modal
        isDialogOpen={secret?.kind === 'regenerated'}
        onOpenChange={(open) => !open && setSecret(null)}
        size="md"
        closeOnOutsideClick={false}
        icon={<ArrowsClockwise size={16} />}
        dialogTitle={t('dashboard.organization.api_access.regenerate_title')}
        dialogDescription={secret?.name}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setSecret(null)}>
              {t('dashboard.organization.api_access.done')}
            </Button>
          </div>
        }
        dialogContent={
          secret?.kind === 'regenerated' ? (
            <SecretOnce
              title={t('dashboard.organization.api_access.save_new_token')}
              hint={t('dashboard.organization.api_access.save_new_token_hint')}
              label={t('dashboard.organization.api_access.your_api_token')}
              value={secret.value}
            />
          ) : null
        }
      />

      {/* Token details */}
      <Modal
        isDialogOpen={!!viewToken}
        onOpenChange={(open) => !open && setViewToken(null)}
        size="lg"
        icon={<Key size={16} />}
        dialogTitle={viewToken?.name ?? t('dashboard.organization.api_access.token_details')}
        dialogDescription={viewToken?.description || t('dashboard.organization.api_access.token_details')}
        dialogContent={
          viewToken ? (
            <div className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                <Fact label={t('common.status')}>
                  {viewToken.is_active ? (
                    <Chip tone="emerald">{t('dashboard.organization.api_access.active')}</Chip>
                  ) : (
                    <Chip>{t('dashboard.organization.api_access.revoked')}</Chip>
                  )}
                </Fact>
                <Fact label={t('dashboard.organization.api_access.token_prefix')}>
                  <code dir="ltr" className="font-mono text-[12.5px] text-neutral-700 bg-neutral-100 rounded-md px-1.5 py-0.5">
                    {viewToken.token_prefix}…
                  </code>
                </Fact>
                <Fact label={t('dashboard.organization.api_access.created')}>{dateFmt(viewToken.creation_date)}</Fact>
                <Fact label={t('dashboard.organization.api_access.last_used')}>
                  {viewToken.last_used_at ? dateFmt(viewToken.last_used_at) : t('dashboard.organization.api_access.never')}
                </Fact>
                <Fact label={t('dashboard.organization.api_access.expires')}>
                  {viewToken.expires_at ? dateFmt(viewToken.expires_at) : t('dashboard.organization.api_access.never')}
                </Fact>
                <Fact label={t('dashboard.developers.api.access')}>
                  <RightsChips rights={viewToken.rights} max={1} />
                </Fact>
              </dl>
              {viewToken.rights && (
                <div>
                  <FieldLabel>{t('dashboard.organization.api_access.permissions_label')}</FieldLabel>
                  <PermissionsMatrix rights={viewToken.rights} />
                </div>
              )}
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('dashboard.organization.api_access.revoke_title')}
        message={
          <>
            {t('dashboard.organization.api_access.revoke_confirm')}
            {revokeTarget && <TokenRef token={revokeTarget} />}
          </>
        }
        confirmLabel={t('dashboard.organization.api_access.revoke_token')}
        onConfirm={handleRevokeToken}
      />

      <ConfirmDialog
        open={!!regenTarget}
        onOpenChange={(open) => !open && setRegenTarget(null)}
        tone="info"
        title={t('dashboard.organization.api_access.regenerate_title')}
        message={
          <>
            {t('dashboard.organization.api_access.regenerate_desc')}
            {regenTarget && <TokenRef token={regenTarget} />}
          </>
        }
        confirmLabel={t('dashboard.organization.api_access.regenerate')}
        onConfirm={handleRegenerateToken}
      />
    </FeatureGate>
  )
}

function TokenRef({ token }: { token: APIToken }) {
  return (
    <span className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3 py-2">
      <Key size={14} className="text-neutral-400 shrink-0" />
      <span className="font-medium text-neutral-800 truncate">{token.name}</span>
      <code dir="ltr" className="ms-auto font-mono text-xs text-neutral-500">{token.token_prefix}…</code>
    </span>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-xs text-neutral-600 truncate">
      <span className="lg:hidden text-neutral-400">{label}: </span>
      {children}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-neutral-400">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-800">{children}</dd>
    </div>
  )
}

// Rights summarised as chips: a preset name, or the resources it touches
// with their CRUD letters.
function RightsChips({ rights, max = 2 }: { rights: APITokenRights | null; max?: number }) {
  const { t } = useTranslation()
  const preset = presetOf(rights)
  if (!rights || !preset) return <span className="text-xs text-neutral-400">—</span>
  if (preset === 'full')
    return (
      <Chip tone="violet" icon={<Lightning size={11} weight="fill" />}>
        {t('dashboard.organization.api_access.full_access')}
      </Chip>
    )
  if (preset === 'readonly')
    return (
      <Chip tone="sky" icon={<Eye size={11} weight="bold" />}>
        {t('dashboard.organization.api_access.read_only')}
      </Chip>
    )
  const granted = RESOURCES.map((r) => ({
    ...r,
    letters: r.actions.filter((a) => has(rights, r.key, a)).map((a) => ACTION_LETTER[a]).join(''),
  })).filter((r) => r.letters)
  if (!granted.length) return <Chip>{t('dashboard.developers.api.no_access')}</Chip>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {granted.slice(0, max).map((r) => (
        <Chip key={r.key}>
          {t(r.labelKey)}
          <span className="font-mono text-[10px] text-neutral-400">{r.letters}</span>
        </Chip>
      ))}
      {granted.length > max && (
        <span className="text-xs font-semibold text-neutral-400 tabular-nums" title={granted.slice(max).map((r) => t(r.labelKey)).join(', ')}>
          +{granted.length - max}
        </span>
      )}
    </div>
  )
}

// Resource × action grid. Editable when `onChange` is passed, otherwise a
// read-only preview of what a preset (or an existing token) grants.
function PermissionsMatrix({
  rights,
  onChange,
}: {
  rights: APITokenRights
  onChange?: (_rights: APITokenRights) => void
}) {
  const { t } = useTranslation()
  const editable = !!onChange
  const actionLabels: Record<Action, string> = {
    action_create: t('dashboard.organization.api_access.perm_create'),
    action_read: t('dashboard.organization.api_access.perm_read'),
    action_update: t('dashboard.organization.api_access.perm_update'),
    action_delete: t('common.delete'),
  }

  const toggle = (resource: keyof APITokenRights, action: Action) => {
    if (!onChange) return
    const next = { ...rights } as any
    next[resource] = { ...(next[resource] ?? {}), [action]: !next[resource]?.[action] }
    onChange(next)
  }
  const toggleRow = (resource: keyof APITokenRights, actions: readonly Action[]) => {
    if (!onChange) return
    const all = actions.every((a) => has(rights, resource, a))
    const next = { ...rights } as any
    next[resource] = { ...(next[resource] ?? {}) }
    actions.forEach((a) => (next[resource][a] = !all))
    onChange(next)
  }

  return (
    <div className={`rounded-xl ring-1 ring-inset ring-neutral-200/80 overflow-hidden ${editable ? '' : 'bg-neutral-50/50'}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,3.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)] items-center px-3 py-2 border-b border-neutral-100 text-[11px] font-medium text-neutral-400">
        <span>{t('dashboard.organization.api_access.resource')}</span>
        {ACTIONS.map((a) => (
          <span key={a} className="text-center truncate">
            {actionLabels[a]}
          </span>
        ))}
      </div>
      <div className="divide-y divide-neutral-100">
        {RESOURCES.map(({ key, labelKey, actions }) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(0,1fr)_repeat(4,3.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)] items-center px-3 py-1.5"
          >
            {editable ? (
              <button
                type="button"
                onClick={() => toggleRow(key, actions)}
                className="text-start text-[13px] font-medium text-neutral-700 hover:text-neutral-950 truncate"
                title={t('dashboard.developers.api.toggle_row')}
              >
                {t(labelKey)}
              </button>
            ) : (
              <span className="text-[13px] font-medium text-neutral-700 truncate">{t(labelKey)}</span>
            )}
            {ACTIONS.map((a) => {
              if (!actions.includes(a)) return <span key={a} className="text-center text-neutral-300">·</span>
              const on = has(rights, key, a)
              return (
                <span key={a} className="flex justify-center">
                  <button
                    type="button"
                    disabled={!editable}
                    aria-pressed={on}
                    aria-label={`${t(labelKey)} ${actionLabels[a]}`}
                    onClick={() => toggle(key, a)}
                    className={`w-7 h-6 rounded-md font-mono text-[11px] font-bold transition-colors ${
                      on
                        ? 'bg-neutral-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                        : 'bg-white text-neutral-300 ring-1 ring-inset ring-neutral-200'
                    } ${editable ? (on ? 'hover:bg-neutral-700' : 'hover:text-neutral-500 hover:ring-neutral-300') : 'cursor-default'}`}
                  >
                    {ACTION_LETTER[a]}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default OrgEditAPIAccess
