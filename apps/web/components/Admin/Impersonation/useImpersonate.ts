'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { errorMessage, startImpersonation } from '@services/ee/platform/api'
import { useAccessToken, useFrontendDomain } from '@components/Admin/hooks'

// "Impersonate" in the console: starts at once (the member clicked, or the
// org's owner) and opens the org as them. End comes back to this page.

export function orgUrl(slug: string | null | undefined, path: string, domain: string): string {
  const tenancy = document.cookie.split('; ').find((c) => c.startsWith('LH_tenancy='))?.split('=')[1]
  // Same origin on a single-org install; the org's own subdomain otherwise
  // (the impersonation cookie is shared across the platform's subdomains).
  return tenancy === 'multi' && slug ? `${window.location.protocol}//${slug}.${domain}${path}` : path
}

export function useImpersonate() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const domain = useFrontendDomain()
  const [busy, setBusy] = React.useState(false)

  const impersonate = React.useCallback(
    async ({ orgId, userId, slug }: { orgId: number; userId?: number | null; slug?: string | null }) => {
      setBusy(true)
      try {
        const res = await startImpersonation(token, {
          org_id: orgId,
          user_id: userId ?? null,
          return_url: `${window.location.pathname}${window.location.search}`,
        })
        const landing = res.landing && res.landing.startsWith('/') ? res.landing : '/'
        // Full navigation: the org pages must load on the impersonation.
        window.location.assign(orgUrl(res.session?.org?.slug || slug, landing, domain))
      } catch (err) {
        toast.error(errorMessage(err, t('admin.common.error_desc')))
        setBusy(false)
      }
    },
    [token, domain, t],
  )

  return { impersonate, busy }
}
