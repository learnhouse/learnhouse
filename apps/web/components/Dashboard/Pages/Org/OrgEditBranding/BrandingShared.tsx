'use client'
import React, { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { ArrowsClockwise, CloudArrowUp, Icon as PhosphorIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@components/ui/button'
import { queryKeys } from '@/lib/query/keys'
import { revalidateTags } from '@services/utils/ts/requests'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgAuthBackgroundMediaDirectory } from '@services/media/media'

/* ------------------------------------------------------------------------ */
/* Upload plumbing                                                           */
/* ------------------------------------------------------------------------ */

interface UseAssetUploadOptions {
  upload: (_orgId: string, _file: File, _accessToken: string) => Promise<unknown>
  loading: string
  success: string
  error: string
}

/**
 * Optimistic asset upload: shows the picked file immediately, uploads it,
 * then refreshes the org so every surface (sidebar, sign-in page, hub) picks
 * the new file up. The short wait after upload gives the media host time to
 * serve the new object before the refreshed org points at it.
 */
export function useAssetUpload({ upload, loading, success, error }: UseAssetUploadOptions) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    setLocalUrl(URL.createObjectURL(file))
    setUploading(true)
    const toastId = toast.loading(loading)
    try {
      await upload(org.id, file, accessToken)
      await new Promise((r) => setTimeout(r, 1200))
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(success, { id: toastId })
      router.refresh()
    } catch (_err) {
      setLocalUrl(null)
      toast.error(error, { id: toastId })
    } finally {
      setUploading(false)
    }
  }

  return { localUrl, uploading, handleFile }
}

/* ------------------------------------------------------------------------ */
/* Layout primitives                                                         */
/* ------------------------------------------------------------------------ */

interface BrandingSectionProps {
  icon: PhosphorIcon
  title: string
  description: string
  children: React.ReactNode
  /** Vignettes showing where the asset is used. */
  aside?: React.ReactNode
  asideLabel?: string
  className?: string
}

/**
 * One asset or setting: controls on the left, the places it shows up on the
 * right. Sections stack with a hairline between them so the tab reads as a
 * single sheet rather than a pile of cards.
 */
export function BrandingSection({
  icon: Icon,
  title,
  description,
  children,
  aside,
  asideLabel,
  className,
}: BrandingSectionProps) {
  const { t } = useTranslation()
  return (
    <section
      className={cn(
        'grid gap-8 px-5 py-7 border-b border-gray-100 last:border-b-0',
        aside ? 'lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]' : '',
        className
      )}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
            <Icon size={16} weight="bold" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</h3>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed max-w-prose">{description}</p>
          </div>
        </div>
        <div className="mt-5">{children}</div>
      </div>
      {aside && (
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">
            {asideLabel ?? t('dashboard.organization.branding.where_it_appears')}
          </p>
          <div className="flex flex-wrap gap-4">{aside}</div>
        </div>
      )}
    </section>
  )
}

export function SpecList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-gray-300" aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  )
}

interface SaveBarProps {
  onSave: () => void
  saving: boolean
  disabled?: boolean
  note?: string
}

export function SaveBar({ onSave, saving, disabled, note }: SaveBarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 bg-gray-50/70 border-t border-gray-100 rounded-b-xl">
      <p className="text-xs text-gray-400">{note}</p>
      <Button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="bg-black text-white hover:bg-black/90 rounded-lg"
      >
        {saving
          ? t('dashboard.organization.settings.saving')
          : t('dashboard.organization.settings.save_changes')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Image dropzone                                                            */
/* ------------------------------------------------------------------------ */

export type DropzoneShape = 'wide' | 'square' | 'icon'

interface ImageDropzoneProps {
  id: string
  shape: DropzoneShape
  currentUrl?: string | null
  accept: string
  uploading: boolean
  onFile: (_file: File) => void
  /** Copy for the empty state, e.g. "Add a square logo". */
  emptyLabel: string
  /** Copy for the filled state, e.g. "Replace square logo". */
  replaceLabel: string
  /** Shown under the box when the asset is inherited (square logo falling back to the wide one). */
  inheritedNote?: string
  className?: string
}

/** Checkerboard so transparent PNGs read the way they will on a real surface. */
export const checkerStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg, #ececec 25%, transparent 25%), linear-gradient(-45deg, #ececec 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ececec 75%), linear-gradient(-45deg, transparent 75%, #ececec 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
}

const SHAPE_CLASS: Record<DropzoneShape, string> = {
  wide: 'w-[240px] h-[120px]',
  square: 'w-[120px] h-[120px]',
  icon: 'w-[72px] h-[72px]',
}

/**
 * Click-or-drop upload target that always shows the current asset on a
 * checkerboard, so transparent PNGs read the way they will on a real surface.
 */
export function ImageDropzone({
  id,
  shape,
  currentUrl,
  accept,
  uploading,
  onFile,
  emptyLabel,
  replaceLabel,
  inheritedNote,
  className,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onFile(file)
  }

  return (
    <div className={cn('flex flex-col items-start gap-3', className)}>
      <div className="flex items-end gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            pick(e.dataTransfer.files)
          }}
          aria-label={currentUrl ? replaceLabel : emptyLabel}
          style={currentUrl ? checkerStyle : undefined}
          className={cn(
            'group relative shrink-0 overflow-hidden rounded-xl border transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40',
            SHAPE_CLASS[shape],
            currentUrl ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100',
            dragging && 'border-black bg-gray-100',
            uploading && 'opacity-60'
          )}
        >
          {currentUrl ? (
            <>
              <img
                src={currentUrl}
                alt=""
                className={cn(
                  'h-full w-full',
                  shape === 'square' ? 'object-cover' : 'object-contain',
                  shape === 'wide' && 'p-3',
                  shape === 'icon' && 'p-3'
                )}
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <ArrowsClockwise size={shape === 'icon' ? 16 : 20} weight="bold" />
              </span>
            </>
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center text-gray-400">
              <CloudArrowUp size={shape === 'icon' ? 18 : 22} weight="regular" />
              {shape !== 'icon' && <span className="text-[11px] leading-tight">{emptyLabel}</span>}
            </span>
          )}
        </button>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-white"
          >
            <CloudArrowUp size={14} weight="bold" className="me-1.5" />
            {currentUrl ? replaceLabel : emptyLabel}
          </Button>
          {inheritedNote && <p className="text-[11px] text-amber-700/90 max-w-[220px]">{inheritedNote}</p>}
        </div>
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Color helpers                                                             */
/* ------------------------------------------------------------------------ */

export function hexToRgba(hex: string, alpha: number): string {
  if (!hex || hex.length < 7) return 'transparent'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if ([r, g, b].some(Number.isNaN)) return 'transparent'
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function isLightHex(hex: string): boolean {
  if (!hex || hex.length < 7) return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if ([r, g, b].some(Number.isNaN)) return true
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
}

/* ------------------------------------------------------------------------ */
/* Sign-in page branding                                                     */
/* ------------------------------------------------------------------------ */

export interface AuthBrandingState {
  welcome_message: string
  background_type: 'gradient' | 'custom' | 'unsplash'
  background_image: string
  text_color: 'light' | 'dark'
  unsplash_photographer_name: string
  unsplash_photographer_url: string
  unsplash_photo_url: string
}

export const AUTH_GRADIENT = 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)'

export function readAuthBranding(org: any): AuthBrandingState {
  const c = org?.config?.config?.customization?.auth_branding || org?.config?.config?.general?.auth_branding || {}
  return {
    welcome_message: c.welcome_message || '',
    background_type: c.background_type || 'gradient',
    background_image: c.background_image || '',
    text_color: c.text_color || 'light',
    unsplash_photographer_name: c.unsplash_photographer_name || '',
    unsplash_photographer_url: c.unsplash_photographer_url || '',
    unsplash_photo_url: c.unsplash_photo_url || '',
  }
}

/** Mirrors AuthBrandingPanel's background resolution so previews match the real page. */
export function authBackgroundStyle(
  org: any,
  state: Pick<AuthBrandingState, 'background_type' | 'background_image'>,
  localPreview?: string | null
): React.CSSProperties {
  if (state.background_type === 'gradient' || !state.background_image) {
    return { background: AUTH_GRADIENT }
  }
  const url =
    state.background_type === 'custom'
      ? localPreview || getOrgAuthBackgroundMediaDirectory(org?.org_uuid, state.background_image)
      : state.background_image
  return { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
}
