'use client'
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowsClockwise, CheckCircle, CircleNotch, Copy, LinkSimple, WarningCircle } from '@phosphor-icons/react'
import { Button, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { checkSlug, suggestSlug, updateSeoSettings, type SlugCheck } from '@services/seo/seo'
import { revalidateTags } from '@services/utils/ts/requests'
import { slugError, slugify } from '@/lib/seo/slugify'
import { useAbsoluteUrl } from '@/lib/seo/useAbsoluteUrl'
import { useSeoT } from '@/lib/seo/i18n'
import { resourceSegment, type SeoResourceType } from '@/lib/seo/paths'

/**
 * Edit a resource's URL slug: live preview of the full address, format
 * validation as you type, an availability check against the API, "generate
 * from title", and an explicit save (the old address keeps redirecting).
 */
export function SlugField({
  type,
  uuid,
  orgId,
  orgslug,
  title,
  slug,
  token,
  onSaved,
}: {
  type: SeoResourceType
  uuid: string
  orgId: number
  orgslug: string
  title: string
  slug: string | null
  token?: string
  onSaved?: (slug: string) => void
}) {
  const st = useSeoT()
  const [value, setValue] = useState(slug || '')
  const [check, setCheck] = useState<SlugCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => setValue(slug || ''), [slug])

  const normalized = useMemo(() => slugify(value), [value])
  const formatError = value ? slugError(normalized) : 'empty'
  const dirty = normalized !== (slug || '')
  const siteBase = useAbsoluteUrl(orgslug, '/')
  const segmentBase = `${siteBase}${resourceSegment(type)}`
  const fullUrl = `${segmentBase}${normalized || ''}`

  // Availability, debounced; only for well-formed changed slugs.
  useEffect(() => {
    if (!dirty || formatError) {
      setCheck(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const id = setTimeout(async () => {
      try {
        const res = await checkSlug(orgId, type, normalized, uuid, token)
        if (!cancelled) setCheck(res)
      } catch {
        if (!cancelled) setCheck(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [normalized, dirty, formatError, orgId, type, uuid, token])

  const regenerate = async () => {
    try {
      setValue(await suggestSlug(orgId, type, title, uuid, token))
    } catch {
      setValue(slugify(title))
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await updateSeoSettings(type, uuid, { slug: normalized }, token)
      toast.success(st('slug.saved'))
      revalidateTags(['seo-sitemap'], orgslug)
      onSaved?.(res.slug || normalized)
    } catch (e: any) {
      const reason = e?.detail?.reason || e?.message
      toast.error(reason && typeof reason === 'string' ? st(`slug.errors.${reason}`) : st('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const error = formatError && value ? formatError : check && !check.available ? check.reason : null
  const blocked = !!formatError || checking || (check ? !check.available : dirty)

  return (
    <SectionCard icon={<LinkSimple size={18} />} title={st('slug.title')} description={st('slug.subtitle')}>
      <label htmlFor={`slug-${uuid}`} className="text-sm font-semibold text-neutral-800">
        {st('slug.label')}
      </label>
      <div className="mt-1.5 flex flex-wrap items-stretch gap-2">
        <div className="flex min-w-0 basis-full sm:basis-0 flex-1 items-center rounded-xl ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900/15 bg-white overflow-hidden" dir="ltr">
          <span className="ps-3 text-sm text-neutral-400 whitespace-nowrap max-w-[45%] truncate">{segmentBase.replace(/^https?:\/\//, '')}</span>
          <input
            id={`slug-${uuid}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => value && setValue(slugify(value))}
            spellCheck={false}
            autoCapitalize="off"
            className="h-9 min-w-0 flex-1 bg-transparent pe-3 text-sm font-medium text-neutral-900 focus:outline-none"
            aria-invalid={!!error}
            aria-describedby={`slug-status-${uuid}`}
          />
        </div>
        <Button onClick={regenerate} icon={<ArrowsClockwise size={14} />}>
          {st('slug.regenerate')}
        </Button>
        <Button variant="primary" onClick={save} disabled={!dirty || blocked} loading={saving}>
          {st('slug.save')}
        </Button>
      </div>
      <div id={`slug-status-${uuid}`} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs min-h-5" aria-live="polite">
        {error ? (
          <span className="inline-flex items-center gap-1 font-medium text-rose-600">
            <WarningCircle size={14} weight="fill" />
            {st(`slug.errors.${error}`)}
            {check?.suggestion && (
              <button type="button" className="ms-1 underline underline-offset-2" onClick={() => setValue(check.suggestion || '')}>
                {st('slug.suggestion', { slug: check.suggestion })}
              </button>
            )}
          </span>
        ) : checking ? (
          <span className="inline-flex items-center gap-1 text-neutral-500">
            <CircleNotch size={12} className="animate-spin" />
            {st('slug.checking')}
          </span>
        ) : dirty && check?.available ? (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
            <CheckCircle size={14} weight="fill" />
            {st('slug.available')}
          </span>
        ) : null}
        <button
          type="button"
          className="ms-auto inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-800"
          onClick={() => {
            navigator.clipboard?.writeText(fullUrl).then(() => toast.success(st('slug.copied')))
          }}
        >
          <Copy size={12} />
          <span dir="ltr" className="truncate max-w-[22rem]">{fullUrl}</span>
        </button>
      </div>
    </SectionCard>
  )
}
