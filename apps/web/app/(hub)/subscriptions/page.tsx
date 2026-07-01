'use client'
import React, { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight, CreditCard, TentTree } from 'lucide-react'
import { Toaster, toast } from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { apiFetch } from '@services/utils/ts/requests'
import { billingPortal, fetchSubscription } from '../billing/_lib/billingClient'
import { findPlan } from '../billing/_lib/plans'

// Resolve the statically-configured plan id when there is no live subscription.
// Mirrors resolveCurrentPlanId() in billing/page.tsx.
function resolveCurrentPlanId(org: any): string {
  const cfg = org?.config?.config
  return cfg?.plan ?? cfg?.cloud?.plan ?? 'free'
}

function planLabel(planId: string | undefined): string {
  if (!planId) return 'Free'
  return findPlan(planId)?.name ?? planId
}

function StatusPill({ subscription, t }: { subscription: any; t: any }) {
  if (!subscription) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-black/[0.05] text-black/50">
        {t('subscriptions.no_subscription', { defaultValue: 'No subscription' })}
      </span>
    )
  }

  // A subscription set to cancel at period end takes visual priority.
  if (subscription.cancelAtPeriodEnd) {
    const end = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()
      : null
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">
        {end
          ? t('subscriptions.cancels_on', { defaultValue: 'Cancels on {{date}}', date: end })
          : t('subscriptions.cancels', { defaultValue: 'Cancels at period end' })}
      </span>
    )
  }

  const status = String(subscription.status || '').toLowerCase()
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    trialing: 'bg-blue-50 text-blue-700',
    past_due: 'bg-red-50 text-red-700',
    canceled: 'bg-black/[0.05] text-black/50',
    unpaid: 'bg-red-50 text-red-700',
  }
  const labels: Record<string, string> = {
    active: t('subscriptions.status_active', { defaultValue: 'Active' }),
    trialing: t('subscriptions.status_trialing', { defaultValue: 'Trialing' }),
    past_due: t('subscriptions.status_past_due', { defaultValue: 'Past due' }),
    canceled: t('subscriptions.status_canceled', { defaultValue: 'Canceled' }),
    unpaid: t('subscriptions.status_unpaid', { defaultValue: 'Unpaid' }),
  }
  const cls = styles[status] ?? 'bg-black/[0.05] text-black/50'
  const label = labels[status] ?? subscription.status

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function OrgSubscriptionRow({ org, enabled }: { org: any; enabled: boolean }) {
  const { t } = useTranslation()
  const initial = (org.name || org.slug || '?').trim().charAt(0).toUpperCase()

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['billing', 'subscription', org.id],
    queryFn: () => fetchSubscription(org.id),
    enabled: enabled && !!org.id,
    staleTime: 30_000,
  })

  const planId = subscription?.plan ?? resolveCurrentPlanId(org)
  const periodEnd =
    subscription?.currentPeriodEnd && !subscription.cancelAtPeriodEnd
      ? new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()
      : null

  return (
    <Link
      href={`/billing?org=${org.slug}`}
      className="relative flex items-center p-4 bg-white rounded-2xl nice-shadow hover:shadow-lg transition-all group"
    >
      {org.logo_image ? (
        <img
          src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
          alt={org.name}
          className="w-11 h-11 rounded-xl object-cover flex-shrink-0 ring-1 ring-inset ring-black/5"
        />
      ) : (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700 font-bold text-lg flex-shrink-0 ring-1 ring-inset ring-black/5">
          {initial}
        </div>
      )}

      <div className="ml-3 flex-1 min-w-0">
        <div className="font-semibold text-gray-900 tracking-tight truncate">{org.name}</div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {subLoading ? (
            <span className="inline-block h-4 w-24 rounded-full bg-black/[0.05] animate-pulse" />
          ) : (
            <>
              <span className="text-xs font-medium text-black/60">{planLabel(planId)}</span>
              <StatusPill subscription={subscription} t={t} />
              {periodEnd && (
                <span className="text-[11px] text-black/35">
                  {t('subscriptions.renews_on', { defaultValue: 'Renews {{date}}', date: periodEnd })}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <span className="ml-3 hidden sm:flex items-center gap-1 text-xs font-semibold text-black/40 group-hover:text-black/70 transition-colors flex-shrink-0">
        {t('subscriptions.manage_plan', { defaultValue: 'Manage plan' })}
        <ChevronRight
          size={16}
          className="group-hover:translate-x-0.5 transition-transform"
        />
      </span>
      <ChevronRight
        size={18}
        className="ml-3 sm:hidden text-black/25 group-hover:text-black/60 transition-all flex-shrink-0"
      />
    </Link>
  )
}

function SubscriptionsClient() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()

  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  const [portalLoading, setPortalLoading] = React.useState(false)

  // Redirect unauthenticated users to login (mirror app/home/home.tsx).
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs', 'user'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/user/page/1/limit/50`, access_token),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })

  async function handleManageBilling() {
    if (portalLoading) return
    setPortalLoading(true)
    try {
      // Sends no orgId/email — the route derives identity from the session cookie.
      const { url } = await billingPortal()
      if (url) {
        window.location.href = url
      } else {
        throw new Error('No portal URL returned')
      }
    } catch {
      toast.error(
        t('subscriptions.portal_error', {
          defaultValue: 'Could not open the billing portal. Please try again.',
        })
      )
      setPortalLoading(false)
    }
  }

  const showLoader = isLoading || (isAuthenticated && orgsLoading)

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <Toaster />
      <div className="relative min-h-screen">
        {/* Blueprint grid — fades in from bottom */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 min-h-screen px-4 py-8">
          <div className="w-full max-w-2xl mx-auto">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-8">
              <Link
                href="/home"
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-white nice-shadow text-black/50 hover:text-black transition-colors flex-shrink-0"
                aria-label={t('subscriptions.back_home', { defaultValue: 'Back to home' })}
              >
                <ArrowLeft size={16} />
              </Link>
              {isAuthenticated && <UserAvatar border="border-2" rounded="rounded-full" width={36} />}
            </div>

            {/* Heading + manage billing */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="min-w-0">
                <h1 className="font-black tracking-tight text-2xl text-gray-900">
                  {t('subscriptions.title', { defaultValue: 'Subscriptions' })}
                </h1>
                <p className="mt-1.5 text-sm text-black/40">
                  {t('subscriptions.subtitle', {
                    defaultValue: 'Plans and billing across your organizations',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl font-semibold text-sm nice-shadow hover:bg-gray-800 transition-colors disabled:opacity-50 flex-shrink-0"
              >
                <CreditCard size={16} />
                {portalLoading
                  ? t('subscriptions.opening', { defaultValue: 'Opening…' })
                  : t('subscriptions.manage_billing', { defaultValue: 'Manage billing' })}
              </button>
            </div>

            {/* Org subscription list */}
            <div className="w-full space-y-2.5">
              {showLoader && (
                <>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-[68px] w-full rounded-2xl bg-black/[0.03] animate-pulse"
                    />
                  ))}
                </>
              )}

              {!showLoader && isAuthenticated && Array.isArray(orgs) && orgs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 px-6 bg-white rounded-2xl nice-shadow">
                  <TentTree className="text-black/10" size={64} />
                  <p className="mt-4 text-sm font-semibold text-black/50 text-center">
                    {t('common.no_orgs_message', {
                      defaultValue: 'You are not part of any organization yet.',
                    })}
                  </p>
                </div>
              )}

              {!showLoader &&
                isAuthenticated &&
                Array.isArray(orgs) &&
                orgs.map((org: any) => (
                  <OrgSubscriptionRow
                    key={org.id ?? org.slug}
                    org={org}
                    enabled={isAuthenticated}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[100] bg-white" />}>
      <SubscriptionsClient />
    </Suspense>
  )
}
