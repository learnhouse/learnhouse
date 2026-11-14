'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Buildings, EnvelopeSimple, Globe, GoogleLogo, Info, Key, Password } from '@phosphor-icons/react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import { Chip, SectionCard, SettingRow, StickySaveBar } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  ALL_AUTH_METHODS,
  AUTH_METHOD_OPTIONS,
  Notice,
  ReadOnlyNotice,
  SecuritySkeleton,
  sameMethodSet,
  useOrgSecurityPolicy,
} from './shared'

/**
 * Users → Sign-in methods. Owns which methods members may use to reach this org
 * and whether a session started on the central apex counts here.
 *
 * Both settings are enforced twice: at the door (the login endpoints refuse a
 * disallowed method for this org) and on every request afterwards (the org gate
 * refuses a session whose method is no longer allowed). Checking every box is
 * the unrestricted default.
 */
const METHOD_ICONS: Record<string, React.ElementType> = {
  password: Password,
  magic_login: EnvelopeSimple,
  google: GoogleLogo,
  sso: Buildings,
}

const OrgSignInMethods: React.FC = () => {
  const { t } = useTranslation()
  const { canManageOrg } = useAdminStatus()
  const {
    orgId,
    policy,
    policyLoading,
    seedVersion,
    savePolicy,
    saving,
    saveError,
    setSaveError,
    setNeedsOwnMfa,
  } = useOrgSecurityPolicy()

  const [draftMethods, setDraftMethods] = React.useState<string[]>(policy.allowed_auth_methods)
  const [draftSharing, setDraftSharing] = React.useState(policy.allow_central_session_sharing)

  React.useEffect(() => {
    setDraftMethods(policy.allowed_auth_methods)
    setDraftSharing(policy.allow_central_session_sharing)
  }, [seedVersion, policy])

  const isDirty =
    !sameMethodSet(draftMethods, policy.allowed_auth_methods) ||
    draftSharing !== policy.allow_central_session_sharing

  const toggleMethod = (key: string, checked: boolean) => {
    setSaveError(null)
    setNeedsOwnMfa(false)
    setDraftMethods((prev) =>
      checked ? Array.from(new Set([...prev, key])) : prev.filter((m) => m !== key)
    )
  }

  const restricted =
    draftMethods.length > 0 && !ALL_AUTH_METHODS.every((m) => draftMethods.includes(m))

  if (!orgId) return null
  // Rendering the default (everything allowed) before the saved policy lands
  // would show boxes the admin never ticked.
  if (policyLoading) return <SecuritySkeleton />

  const readOnly = canManageOrg !== true
  const controlsDisabled = saving || readOnly

  const discard = () => {
    setDraftMethods(policy.allowed_auth_methods)
    setDraftSharing(policy.allow_central_session_sharing)
    setSaveError(null)
    setNeedsOwnMfa(false)
  }

  return (
    <div className="flex flex-col gap-5">
      {readOnly && <ReadOnlyNotice />}

      <SectionCard
        icon={<Key size={18} />}
        title={t('dashboard.organization.security.methods_title', {
          defaultValue: 'Allowed sign-in methods',
        })}
        description={t('dashboard.organization.security.methods_description', {
          defaultValue:
            'Choose how members are allowed to sign in to this organization. Leave every method checked to keep sign-in unrestricted.',
        })}
        actions={
          <Chip tone={restricted ? 'amber' : 'emerald'}>
            {restricted
              ? t('dashboard.users.dash.security.restricted', { count: draftMethods.length, total: ALL_AUTH_METHODS.length })
              : t('dashboard.users.dash.security.unrestricted')}
          </Chip>
        }
      >
        <div className="divide-y divide-neutral-100">
          {AUTH_METHOD_OPTIONS.map((m) => {
            const Icon = METHOD_ICONS[m.key] || Key
            const label = t(m.labelKey, { defaultValue: m.labelDefault })
            return (
              <SettingRow
                key={m.key}
                icon={<Icon size={18} />}
                title={<label htmlFor={`auth-method-${m.key}`} className="cursor-pointer">{label}</label>}
                description={t(m.hintKey, { defaultValue: m.hintDefault })}
                control={
                  <Switch
                    id={`auth-method-${m.key}`}
                    checked={draftMethods.includes(m.key)}
                    onCheckedChange={(value) => toggleMethod(m.key, value === true)}
                    disabled={controlsDisabled}
                    aria-label={label}
                  />
                }
              />
            )
          })}
        </div>

        {(draftMethods.length === 0 || restricted) && (
          <div className="mt-4">
            {draftMethods.length === 0 ? (
              <Notice tone="amber">
                {t('dashboard.organization.security.methods_empty_warning', {
                  defaultValue:
                    'With no method selected, no one could sign in to this organization. Pick at least one.',
                })}
              </Notice>
            ) : (
              <Notice tone="neutral" icon={<Info size={16} className="shrink-0 mt-0.5 text-neutral-400" />}>
                {t('dashboard.organization.security.methods_effect', {
                  defaultValue:
                    'Unchecked methods disappear from this organization’s login page, and members already signed in with one are asked to sign in again with an allowed method.',
                })}
              </Notice>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<Globe size={18} />}
        title={t('dashboard.users.dash.security.sessions_title')}
        description={t('dashboard.users.dash.security.sessions_description')}
      >
        <SettingRow
          title={
            <label htmlFor="central-session-sharing" className="cursor-pointer">
              {t('dashboard.organization.security.session_sharing_label', {
                defaultValue: 'Allow sharing sessions with learnhouse.io',
              })}
            </label>
          }
          description={t('dashboard.organization.security.session_sharing_hint', {
            defaultValue:
              'When off, signing in at learnhouse.io won’t let members into this org; they must sign in again from this org’s login page using an allowed method.',
          })}
          control={
            <Switch
              id="central-session-sharing"
              checked={draftSharing}
              onCheckedChange={(checked) => {
                setDraftSharing(checked)
                setSaveError(null)
                setNeedsOwnMfa(false)
              }}
              disabled={controlsDisabled}
              aria-label={t('dashboard.organization.security.session_sharing_label', {
                defaultValue: 'Allow sharing sessions with learnhouse.io',
              })}
            />
          }
        />
      </SectionCard>

      {saveError && <Notice tone="rose">{saveError}</Notice>}

      <StickySaveBar
        visible={isDirty && !readOnly}
        saving={saving}
        disabled={draftMethods.length === 0}
        onSave={() =>
          savePolicy({
            allowed_auth_methods: draftMethods,
            allow_central_session_sharing: draftSharing,
          })
        }
        onDiscard={discard}
      />
    </div>
  )
}

export default OrgSignInMethods
