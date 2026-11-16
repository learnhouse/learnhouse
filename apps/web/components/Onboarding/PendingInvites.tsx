'use client'
import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { EnvelopeSimpleOpen, EnvelopeSimple } from '@phosphor-icons/react'
import { Button } from '@/design'
import OrgSquareLogo from '@components/Objects/Org/OrgSquareLogo'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getUriWithOrg } from '@services/config/config'
import { detailMessage } from '@services/utils/ts/requests'
import { resendVerificationEmail } from '@services/auth/auth'
import { acceptInvite, declineInvite, onboardingKeys, type PendingInvite } from '@services/onboarding/onboarding'

/**
 * Invitations waiting for the signed-in user. Someone invited to a school
 * joins it here in one click instead of being walked through creating an
 * organization of their own.
 */
export default function PendingInvites({
  invites,
  unverified = false,
  className = '',
}: {
  invites: PendingInvite[]
  // The email isn't verified yet: invitations stay hidden (they belong to the
  // verified owner of the address), so ask for verification instead.
  unverified?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('hub')
  const [busy, setBusy] = useState<string | null>(null)
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent'>('idle')

  if (unverified) {
    const email = session?.data?.user?.email
    return (
      <section className={`flex w-full items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900 ${className}`} data-testid="verify-for-invites">
        <EnvelopeSimple size={18} weight="duotone" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('onb2.invites.verify_title')}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">{t('onb2.invites.verify_desc')}</p>
          {email && (
            <button
              type="button"
              disabled={resent !== 'idle'}
              onClick={async () => {
                setResent('sending')
                await resendVerificationEmail(email).catch(() => null)
                setResent('sent')
              }}
              className="mt-2 text-xs font-semibold underline underline-offset-2 disabled:no-underline disabled:opacity-70"
            >
              {resent === 'sent' ? t('onb2.invites.verify_sent') : t('onb2.invites.verify_resend')}
            </button>
          )}
        </div>
      </section>
    )
  }

  if (!invites.length) return null

  const accept = async (inv: PendingInvite) => {
    setBusy(inv.org_uuid)
    try {
      const joined = await acceptInvite(token, inv.org_uuid)
      track(AnalyticsEvent.OnboardingInviteAccepted, { org_id: joined.org_id })
      try {
        await session?.update?.(true)
      } catch {
        /* the new membership is in the next session refresh anyway */
      }
      window.location.href = getUriWithOrg(joined.slug, '/')
    } catch (e: any) {
      toast.error(detailMessage(e?.detail, t('onb2.invites.accept_failed')))
      setBusy(null)
    }
  }

  const decline = async (inv: PendingInvite) => {
    setBusy(inv.org_uuid)
    try {
      await declineInvite(token, inv.org_uuid)
    } catch {
      /* already gone */
    }
    await queryClient.invalidateQueries({ queryKey: onboardingKeys.hub() })
    setBusy(null)
  }

  return (
    <section className={`w-full rounded-2xl bg-white p-4 nice-shadow ${className}`} aria-label={t('onb2.invites.title')}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <EnvelopeSimpleOpen size={16} weight="duotone" className="text-neutral-500" />
        {t('onb2.invites.title')}
      </div>
      <ul className="flex flex-col gap-2">
        {invites.map((inv) => (
          <li key={inv.org_uuid} className="flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5" data-invite={inv.slug}>
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-black/5">
              <OrgSquareLogo
                org={inv as any}
                fallback={
                  <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-sm font-bold text-neutral-600">
                    {(inv.name || '?').charAt(0).toUpperCase()}
                  </div>
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">{inv.name}</p>
              <p className="truncate text-xs text-neutral-500">{t('onb2.invites.invited_you')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={busy === inv.org_uuid} onClick={() => decline(inv)}>
                {t('onb2.invites.decline')}
              </Button>
              <Button size="sm" variant="primary" loading={busy === inv.org_uuid} onClick={() => accept(inv)}>
                {t('onb2.invites.join')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
