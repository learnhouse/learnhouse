'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button } from '@/design'
import { errorMessage, getOrgConfiguration } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { OrgConfiguration, OrgConfigWriteResult, OrgImageSlot } from '@services/ee/platform/types'
import {
  getOrgAuthBackgroundMediaDirectory,
  getOrgFaviconMediaDirectory,
  getOrgLogoMediaDirectory,
  getOrgOgImageMediaDirectory,
  getOrgPreviewMediaDirectory,
  getOrgSquareLogoMediaDirectory,
  getOrgThumbnailMediaDirectory,
} from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import { changeCount } from '../orgConfig'
import { useInvalidateOrg } from '../orgQueries'

// Shared plumbing for the Branding and Configuration tabs: the one query they
// read, the write wrapper (toast, cache update, public-site revalidation) and
// a few layout pieces.

export function useOrgConfiguration(orgId: string) {
  const token = useAccessToken()
  return useQuery({
    queryKey: platformKeys.orgConfiguration(orgId),
    queryFn: () => getOrgConfiguration(token, orgId),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 30_000,
  })
}

/**
 * Runs a write and settles everything around it: the returned configuration
 * replaces the cached one, the header/list refetch (name, logo), the history
 * refetches, and the org's public pages are revalidated so the change shows
 * up there without waiting for the cache to expire.
 */
export function useConfigWrite(orgId: string) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const invalidateOrg = useInvalidateOrg(orgId)
  return React.useCallback(
    async (write: () => Promise<OrgConfigWriteResult>, opts: { success?: string } = {}): Promise<OrgConfigWriteResult | null> => {
      try {
        const result = await write()
        if (result?.configuration) qc.setQueryData(platformKeys.orgConfiguration(orgId), result.configuration)
        qc.invalidateQueries({ queryKey: platformKeys.orgConfigHistory(orgId) })
        invalidateOrg()
        const slug = result?.configuration?.org?.slug
        if (slug) revalidateTags(['organizations'], slug).catch(() => {})
        const n = changeCount(result?.changes)
        toast.success(n ? (opts.success ?? t('admin.org_cfg.saved')) : t('admin.org_cfg.no_changes'))
        return result
      } catch (err) {
        toast.error(errorMessage(err, t('admin.org_detail.failed_save')))
        return null
      }
    },
    [orgId, qc, invalidateOrg, t]
  )
}

const MEDIA: Record<OrgImageSlot, (_uuid: string, _file: string) => string> = {
  logo: getOrgLogoMediaDirectory,
  square_logo: getOrgSquareLogoMediaDirectory,
  favicon: getOrgFaviconMediaDirectory,
  thumbnail: getOrgThumbnailMediaDirectory,
  og_image: getOrgOgImageMediaDirectory,
  auth_background: getOrgAuthBackgroundMediaDirectory,
  preview: getOrgPreviewMediaDirectory,
}

/** Public URL of a stored org image (absolute URLs pass through). */
export function orgImageUrl(slot: OrgImageSlot, cfg: Pick<OrgConfiguration, 'org'> | undefined, filename: string | null | undefined): string | null {
  if (!filename || !cfg?.org?.org_uuid) return null
  if (/^https?:\/\//i.test(filename)) return filename
  return MEDIA[slot](cfg.org.org_uuid, filename)
}

/** Label column + control column (stacks on phones). */
export function ConfigRow({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)] gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Discard / Save under a card, shown only while the card has edits. */
export function CardSaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  error,
  readOnly,
}: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  error?: string | null
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  if (readOnly || !dirty) return null
  return (
    <div className="mt-4 pt-4 border-t border-neutral-100 flex flex-wrap items-center justify-end gap-2">
      {error && <p className="me-auto text-xs font-medium text-rose-600">{error}</p>}
      <span className="me-auto hidden sm:flex items-center gap-1.5 text-xs text-neutral-500">
        {!error && (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {t('dashboard.kit.unsaved_changes')}
          </>
        )}
      </span>
      <Button size="sm" onClick={onDiscard} disabled={saving}>
        {t('admin.org_detail.discard')}
      </Button>
      <Button size="sm" variant="primary" onClick={onSave} loading={saving} disabled={!!error}>
        {t('common.save')}
      </Button>
    </div>
  )
}

/** A draft that resets whenever the saved value changes. */
export function useDraft<T>(saved: T): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [draft, setDraft] = React.useState<T>(saved)
  // Reset during render when the saved value changes (no effect round-trip).
  const key = JSON.stringify(saved)
  const [seen, setSeen] = React.useState(key)
  if (seen !== key) {
    setSeen(key)
    setDraft(saved)
  }
  return [draft, setDraft, () => setDraft(saved)]
}

/** Small read-only value with a "managed by the org" lock tone. */
export function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-neutral-700">{children}</div>
}
