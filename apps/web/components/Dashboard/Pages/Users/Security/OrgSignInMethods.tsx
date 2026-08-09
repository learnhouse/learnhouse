'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import { Checkbox } from '@components/ui/checkbox'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import {
  ALL_AUTH_METHODS,
  AUTH_METHOD_OPTIONS,
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

  return (
    <div className="sm:mx-10 mx-0 space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-gray-100 text-gray-700">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-gray-800">
            {t('dashboard.organization.security.methods_title', {
              defaultValue: 'Allowed sign-in methods',
            })}
          </h1>
          <p className="text-sm text-gray-500">
            {t('dashboard.organization.security.methods_description', {
              defaultValue:
                'Choose how members are allowed to sign in to this organization. Leave every method checked to keep sign-in unrestricted.',
            })}
          </p>
        </div>
      </div>

      {readOnly && <ReadOnlyNotice />}

      <div className="bg-white rounded-xl nice-shadow p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AUTH_METHOD_OPTIONS.map((m) => {
            const checked = draftMethods.includes(m.key)
            return (
              <div key={m.key} className="flex items-start gap-3">
                <Checkbox
                  id={`auth-method-${m.key}`}
                  checked={checked}
                  onCheckedChange={(value) => toggleMethod(m.key, value === true)}
                  disabled={controlsDisabled}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor={`auth-method-${m.key}`} className="cursor-pointer">
                    {t(m.labelKey, { defaultValue: m.labelDefault })}
                  </Label>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {t(m.hintKey, { defaultValue: m.hintDefault })}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {draftMethods.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
            {t('dashboard.organization.security.methods_empty_warning', {
              defaultValue:
                'With no method selected, no one could sign in to this organization. Pick at least one.',
            })}
          </p>
        )}

        {restricted && (
          <p className="text-xs text-gray-500 leading-relaxed">
            {t('dashboard.organization.security.methods_effect', {
              defaultValue:
                'Unchecked methods disappear from this organization’s login page, and members already signed in with one are asked to sign in again with an allowed method.',
            })}
          </p>
        )}

        {/* Central session sharing */}
        <div className="flex items-start justify-between gap-4 pt-1 border-t border-gray-100">
          <div className="min-w-0 pt-4">
            <Label htmlFor="central-session-sharing" className="cursor-pointer">
              {t('dashboard.organization.security.session_sharing_label', {
                defaultValue: 'Allow sharing sessions with learnhouse.io',
              })}
            </Label>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed max-w-xl">
              {t('dashboard.organization.security.session_sharing_hint', {
                defaultValue:
                  'When off, signing in at learnhouse.io won’t let members into this org — they must sign in again from this org’s login page using an allowed method.',
              })}
            </p>
          </div>
          <Switch
            id="central-session-sharing"
            checked={draftSharing}
            onCheckedChange={(checked) => {
              setDraftSharing(checked)
              setSaveError(null)
              setNeedsOwnMfa(false)
            }}
            disabled={controlsDisabled}
            className="shrink-0 mt-5"
            aria-label={t('dashboard.organization.security.session_sharing_label', {
              defaultValue: 'Allow sharing sessions with learnhouse.io',
            })}
          />
        </div>

        {saveError && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200/80 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}

        <div className="flex flex-row-reverse items-center gap-3 pt-1">
          <Button
            type="button"
            onClick={() =>
              savePolicy({
                allowed_auth_methods: draftMethods,
                allow_central_session_sharing: draftSharing,
              })
            }
            disabled={controlsDisabled || !isDirty || draftMethods.length === 0}
            className="bg-black text-white hover:bg-black/90"
          >
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {saving
              ? t('dashboard.organization.security.saving_short', { defaultValue: 'Saving…' })
              : t('dashboard.organization.security.save', { defaultValue: 'Save changes' })}
          </Button>
          {isDirty && !saving && (
            <button
              type="button"
              onClick={() => {
                setDraftMethods(policy.allowed_auth_methods)
                setDraftSharing(policy.allow_central_session_sharing)
                setSaveError(null)
                setNeedsOwnMfa(false)
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {t('dashboard.organization.security.cancel', { defaultValue: 'Cancel' })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default OrgSignInMethods
