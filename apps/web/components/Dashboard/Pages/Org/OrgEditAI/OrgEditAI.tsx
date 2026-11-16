'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getDeploymentMode } from '@services/config/config'
import { revalidateTags } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import {
  ArrowsClockwise,
  Books,
  ChalkboardTeacher,
  ChatsCircle,
  Robot,
  ClosedCaptioning,
  Exam,
  Gauge,
  GlobeStand,
  GraduationCap,
  Image as ImageIcon,
  Info,
  Lightning,
  MagicWand,
  MagnifyingGlass,
  Microphone,
  NotePencil,
  Newspaper,
  Plug,
  PuzzlePiece,
  ShieldWarning,
  SquaresFour,
  Student,
  Translate,
  UploadSimple,
  UsersThree,
  VideoCamera,
  Browser,
  Sparkle,
  ClipboardText,
  PencilSimpleLine,
} from '@phosphor-icons/react'
import { AIMark, aiSurface } from '@components/Objects/AI/AIBrand'
import { Button, Chip, INPUT, SectionCard, SegmentedControl, SettingRow } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Notice } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'
import {
  AI_GROUP_ORDER,
  type AIFeatureGroup,
  type AIFeatureKey,
  type AISettings,
  groupCount,
  parseCreditCap,
  readAISettings,
  visibleFeatures,
} from '@/lib/ai/aiFeatures'

const FEATURE_ICONS: Record<AIFeatureKey, React.ElementType> = {
  atlas: GlobeStand,
  atlas_scheduled: ArrowsClockwise,
  ai_editor: PencilSimpleLine,
  course_builder: Books,
  editor_ai: NotePencil,
  magic_blocks: MagicWand,
  quiz_generation: Exam,
  assignment_generation: ClipboardText,
  course_import: UploadSimple,
  seo: MagnifyingGlass,
  ask_ai: ChatsCircle,
  ai_grading: GraduationCap,
  messaging_agents: Robot,
  plays: PuzzlePiece,
  translations: Translate,
  image_generation: ImageIcon,
  voice: Microphone,
  video_ai: ClosedCaptioning,
  live_session_summary: VideoCamera,
  boards: SquaresFour,
  landing_builder: Browser,
  newsletter: Newspaper,
  mcp_tools: Plug,
}

const GROUP_ICONS: Record<AIFeatureGroup, React.ElementType> = {
  assistants: Sparkle,
  authoring: ChalkboardTeacher,
  learners: Student,
  content: Lightning,
  integrations: Plug,
}

type Patch = {
  ai_enabled?: boolean
  features?: Partial<Record<AIFeatureKey, boolean>>
  ask_ai_staff_only?: boolean
  monthly_credit_cap?: number
}

function applyPatch(s: AISettings, p: Patch): AISettings {
  const enabled = p.ai_enabled ?? s.enabled
  const switches = { ...s.switches, ...(p.features || {}) } as AISettings['switches']
  const features = Object.fromEntries(Object.entries(switches).map(([k, v]) => [k, enabled && v])) as AISettings['features']
  return {
    ...s,
    enabled,
    disabled_by: enabled ? null : s.disabled_by ?? 'org',
    switches,
    features,
    ask_ai_staff_only: p.ask_ai_staff_only ?? s.ask_ai_staff_only,
    monthly_credit_cap: p.monthly_credit_cap ?? s.monthly_credit_cap,
  }
}

const OrgEditAI: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true
  const mode = getDeploymentMode()

  const [settings, setSettings] = React.useState<AISettings | null>(null)
  const [saving, setSaving] = React.useState<string | null>(null)
  const [capInput, setCapInput] = React.useState('')

  // The full settings (the admin's switches, the cap) come from the admin-only
  // route; the public org payload only has the effective booleans.
  React.useEffect(() => {
    if (!org?.id || !access_token) return
    let cancelled = false
    fetch(`${getAPIUrl()}orgs/${org.id}/config/ai/settings`, { headers: { Authorization: `Bearer ${access_token}` } })
      .then(async (res) => {
        const loaded = res.ok ? readAISettings({ resolved_ai: await res.json() }) : readAISettings(org?.config?.config)
        if (cancelled) return
        setSettings(loaded)
        setCapInput(loaded.monthly_credit_cap ? String(loaded.monthly_credit_cap) : '')
      })
      .catch(() => {
        if (!cancelled) setSettings(readAISettings(org?.config?.config))
      })
    return () => {
      cancelled = true
    }
  }, [org?.id, access_token]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (key: string, patch: Patch) => {
    if (!settings) return
    const before = settings
    setSettings(applyPatch(settings, patch))
    setSaving(key)
    try {
      const res = await fetch(`${getAPIUrl()}orgs/${org.id}/config/ai/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`AI settings: ${res.status}`)
      const next = readAISettings({ resolved_ai: await res.json() })
      setSettings(next)
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.ai.toasts.save_success'))
    } catch (err) {
      console.error('Error updating AI settings:', err)
      setSettings(before)
      toast.error(t('dashboard.organization.ai.toasts.save_error'))
    } finally {
      setSaving(null)
    }
  }

  if (!settings) return null

  const locked = !canEdit || saving !== null
  const groups = AI_GROUP_ORDER.map((group) => ({ group, keys: visibleFeatures(group, mode) })).filter((g) => g.keys.length)
  const shown = groups.flatMap((g) => g.keys)
  const totalOn = shown.filter((k) => settings.switches[k]).length
  const cap = parseCreditCap(capInput)
  const capDirty = cap !== null && cap !== settings.monthly_credit_cap

  return (
    <FeatureGate feature="ai" allowWhenDisabled>
      <div className="flex flex-col gap-5" data-testid="org-ai-settings">
        {!canEdit && (
          <Notice tone="amber" icon={<ShieldWarning size={16} />}>
            {t('dashboard.organization.ai.admin_only')}
          </Notice>
        )}
        {settings.disabled_by === 'platform' && (
          <Notice tone="amber">{t('dashboard.organization.ai.platform_disabled')}</Notice>
        )}

        {/* Master switch */}
        <section className={aiSurface.panel}>
          <div aria-hidden="true" className={aiSurface.accent} />
          <div className={`flex flex-wrap items-center gap-4 p-5 ${aiSurface.header}`}>
            <AIMark variant="app" size={40} alt="" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-neutral-900">{t('dashboard.organization.ai.title')}</h2>
                <Chip tone={settings.enabled ? 'emerald' : 'neutral'}>
                  {settings.enabled
                    ? t('dashboard.organization.settings_ui.status_on')
                    : t('dashboard.organization.settings_ui.status_off')}
                </Chip>
              </div>
              <p className="mt-0.5 text-sm text-neutral-500">{t('dashboard.organization.ai.enable_ai_description')}</p>
              {settings.enabled && (
                <p className="mt-1 text-xs font-medium text-violet-700">
                  {t('dashboard.organization.ai.enabled_count', { on: totalOn, total: shown.length })}
                </p>
              )}
            </div>
            <Switch
              id="ai-enabled"
              data-testid="ai-master-switch"
              aria-label={t('dashboard.organization.ai.enable_ai')}
              checked={settings.enabled}
              onCheckedChange={(checked) => save('master', { ai_enabled: checked })}
              disabled={locked}
            />
          </div>
        </section>

        {!settings.enabled && (
          <Notice tone="neutral" icon={<Info size={16} />}>
            {t('dashboard.organization.ai.currently_disabled')}
          </Notice>
        )}

        {groups.map(({ group, keys }) => {
          const GroupIcon = GROUP_ICONS[group]
          const { on, total } = groupCount(settings, keys)
          const allOn = on === total
          return (
            <SectionCard
              key={group}
              icon={<GroupIcon size={18} className="text-violet-600" />}
              title={t(`dashboard.organization.ai.groups.${group}.title`)}
              description={t(`dashboard.organization.ai.groups.${group}.description`)}
              className={settings.enabled ? '' : 'opacity-60'}
              actions={
                <>
                  <Chip tone={on ? 'violet' : 'neutral'}>{`${on}/${total}`}</Chip>
                  <Button
                    size="sm"
                    disabled={locked || !settings.enabled}
                    onClick={() =>
                      save(`group:${group}`, { features: Object.fromEntries(keys.map((k) => [k, !allOn])) })
                    }
                  >
                    {allOn ? t('dashboard.organization.ai.group_all_off') : t('dashboard.organization.ai.group_all_on')}
                  </Button>
                </>
              }
            >
              <div className="divide-y divide-neutral-100">
                {keys.map((key) => {
                  const Icon = FEATURE_ICONS[key]
                  return (
                    <div key={key} className="py-4 first:pt-0 last:pb-0">
                      <SettingRow
                        icon={<Icon size={18} />}
                        title={
                          <label htmlFor={`ai-${key}`} className="cursor-pointer">
                            {t(`dashboard.organization.ai.features.${key}.title`)}
                          </label>
                        }
                        description={t(`dashboard.organization.ai.features.${key}.description`)}
                        control={
                          <Switch
                            id={`ai-${key}`}
                            data-testid={`ai-switch-${key}`}
                            checked={settings.switches[key]}
                            onCheckedChange={(checked) => save(key, { features: { [key]: checked } })}
                            disabled={locked || !settings.enabled}
                          />
                        }
                      />
                      {key === 'ask_ai' && settings.switches.ask_ai && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 ps-[30px]">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                            <UsersThree size={14} />
                            {t('dashboard.organization.ai.ask_ai_audience')}
                          </span>
                          <SegmentedControl
                            ariaLabel={t('dashboard.organization.ai.ask_ai_audience')}
                            value={settings.ask_ai_staff_only ? 'staff' : 'everyone'}
                            options={[
                              { key: 'everyone', label: t('dashboard.organization.ai.audience_everyone') },
                              { key: 'staff', label: t('dashboard.organization.ai.audience_staff') },
                            ]}
                            onChange={(v) => {
                              if (locked || !settings.enabled) return
                              save('audience', { ask_ai_staff_only: v === 'staff' })
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })}

        {/* Monthly credit cap */}
        <SectionCard
          icon={<Gauge size={18} className="text-violet-600" />}
          title={t('dashboard.organization.ai.limits_title')}
          description={t('dashboard.organization.ai.limits_description')}
        >
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (cap !== null && capDirty) save('cap', { monthly_credit_cap: cap })
            }}
          >
            <div className="relative w-full max-w-[220px]">
              <input
                id="ai-monthly-cap"
                data-testid="ai-monthly-cap"
                inputMode="numeric"
                className={`${INPUT} pe-24 tabular-nums`}
                placeholder={t('dashboard.organization.ai.cap_placeholder')}
                aria-label={t('dashboard.organization.ai.limits_title')}
                aria-invalid={cap === null}
                value={capInput}
                disabled={!canEdit}
                onChange={(e) => setCapInput(e.target.value)}
              />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-neutral-400">
                {t('dashboard.organization.ai.cap_unit')}
              </span>
            </div>
            <Button type="submit" variant="primary" size="sm" disabled={!canEdit || !capDirty} loading={saving === 'cap'}>
              {t('dashboard.organization.ai.save_cap')}
            </Button>
            {cap === null && <span className="text-xs text-rose-600">{t('dashboard.organization.ai.cap_invalid')}</span>}
          </form>
        </SectionCard>
      </div>
    </FeatureGate>
  )
}

export default OrgEditAI
