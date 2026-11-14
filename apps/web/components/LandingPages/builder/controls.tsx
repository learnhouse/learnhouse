'use client'
/** Small controls for the builder panels: dense, but on the dashboard's kit. */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, CaretDown, CaretRight, UploadSimple, X } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { uploadLandingContent } from '@services/organizations/orgs'
import { getOrgLandingMediaDirectory } from '@services/media/media'
import toast from 'react-hot-toast'
import { cssColor, cssLength } from '../model/style'

export const FIELD = 'w-full min-w-0 h-8 px-2.5 text-[13px] bg-white rounded-lg ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 placeholder:text-neutral-400 transition-shadow'
export const AREA = 'w-full min-w-0 px-2.5 py-2 text-[13px] bg-white rounded-lg ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 placeholder:text-neutral-400 transition-shadow resize-y'

/** A collapsible group in a panel. */
export function Group({ title, children, defaultOpen = true, aside }: { title: string; children: React.ReactNode; defaultOpen?: boolean; aside?: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="border-b border-neutral-100 last:border-b-0">
      <div className="flex items-center gap-2 px-4 h-10">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1.5 text-[12px] font-semibold text-neutral-800 min-w-0" aria-expanded={open}>
          {open ? <CaretDown size={12} /> : <CaretRight size={12} className="rtl:rotate-180" />}
          <span className="truncate">{title}</span>
        </button>
        {aside}
      </div>
      {open && <div className="px-4 pb-4 flex flex-col gap-3">{children}</div>}
    </div>
  )
}

/** Label start, control end, with an override dot and reset. */
export function Row({ label, children, overridden, onReset, stacked }: { label: string; children: React.ReactNode; overridden?: boolean; onReset?: () => void; stacked?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={stacked ? 'flex flex-col gap-1.5' : 'grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2'} data-row={label}>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[12px] text-neutral-500 truncate">{label}</span>
        {overridden && onReset && (
          <button type="button" onClick={onReset} title={t('landingBuilder.style.reset')} aria-label={t('landingBuilder.style.reset')} className="group inline-flex h-4 w-4 items-center justify-center rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 group-hover:hidden" />
            <ArrowCounterClockwise size={11} className="hidden text-sky-600 group-hover:block" />
          </button>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function TextInput({ value, onChange, placeholder, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input {...rest} className={`${FIELD} ${rest.className || ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export function TextArea({ value, onChange, rows = 3, placeholder, mono }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return <textarea className={`${AREA} ${mono ? 'font-mono text-[12px]' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} />
}

export function Select({ value, options, onChange, labels }: { value: string; options: string[]; onChange: (v: string) => void; labels?: (v: string) => string }) {
  return (
    <select className={`${FIELD} pe-7`} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels ? labels(o) : o}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${checked ? 'bg-neutral-900' : 'bg-neutral-200'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
    </button>
  )
}

/** Pills for a few options (icons or short words). */
export function Pills<T extends string>({ value, options, onChange }: { value: T | undefined; options: { key: T; label: React.ReactNode; title?: string }[]; onChange: (v: T | undefined) => void }) {
  return (
    <div className="flex w-full items-center rounded-lg bg-neutral-100 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          title={o.title}
          aria-label={o.title}
          onClick={() => onChange(value === o.key ? undefined : o.key)}
          className={`flex h-7 flex-1 min-w-0 items-center justify-center rounded-md text-[12px] font-medium transition-colors ${value === o.key ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]' : 'text-neutral-500 hover:text-neutral-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A length: "24" (px), "2rem", "60%", "80vh"; "auto" where allowed. */
export function LengthInput({ value, onChange, placeholder, allowAuto, allowContent, ariaLabel }: { value: unknown; onChange: (v: number | string | undefined) => void; placeholder?: string; allowAuto?: boolean; allowContent?: boolean; ariaLabel?: string }) {
  const shown = value === undefined || value === null ? '' : String(value)
  const [draft, setDraft] = React.useState(shown)
  const [bad, setBad] = React.useState(false)
  React.useEffect(() => {
    // Mirror external changes (undo, breakpoint switch) into the field.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(shown)
    setBad(false)
  }, [shown])
  const commit = (raw: string) => {
    const s = raw.trim()
    if (!s) {
      setBad(false)
      onChange(undefined)
      return
    }
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      setBad(false)
      onChange(Number(s))
      return
    }
    if ((allowAuto && s === 'auto') || (allowContent && s === 'content') || cssLength(s)) {
      setBad(false)
      onChange(s)
      return
    }
    setBad(true)
  }
  return (
    <input
      className={`${FIELD} tabular-nums ${bad ? 'ring-rose-400 focus:ring-rose-400/40' : ''}`}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const n = Number(draft)
          if (Number.isFinite(n) && draft.trim() !== '') {
            e.preventDefault()
            const next = n + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
            setDraft(String(next))
            onChange(next)
          }
        }
      }}
    />
  )
}

export function NumberInput({ value, onChange, min, max, step = 1 }: { value: number | undefined; onChange: (v: number | undefined) => void; min: number; max: number; step?: number }) {
  return (
    <input
      type="number"
      className={`${FIELD} tabular-nums`}
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        if (e.target.value === '') return onChange(undefined)
        const n = Math.min(max, Math.max(min, Number(e.target.value)))
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

const TOKENS = ['$primary', '$secondary', '$accent', '$text', '$muted', '$background', '$surface', '$border'] as const

/** Theme tokens first, then any color. */
export function ColorInput({ value, onChange, placeholder, allowNone = true }: { value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string; allowNone?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [hex, setHex] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const css = value ? cssColor(value) : null
  const label = value?.startsWith('$') ? t(`landingBuilder.tokens.${value.slice(1)}`) : value || placeholder || t('landingBuilder.style.none')
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${FIELD} flex items-center gap-2 text-start`} aria-expanded={open}>
        <span className="h-4 w-4 flex-none rounded ring-1 ring-black/10" style={{ background: css || 'repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 50%/8px 8px' }} />
        <span className={`truncate ${value ? 'text-neutral-800' : 'text-neutral-400'}`}>{label}</span>
      </button>
      {open && (
        <div className="absolute end-0 top-full z-30 mt-1 w-60 rounded-xl bg-white p-3 nice-shadow ring-1 ring-black/5">
          <div className="text-[11px] font-medium text-neutral-400 mb-2">{t('landingBuilder.style.theme_colors')}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {TOKENS.map((tok) => (
              <button
                key={tok}
                type="button"
                title={t(`landingBuilder.tokens.${tok.slice(1)}`)}
                aria-label={t(`landingBuilder.tokens.${tok.slice(1)}`)}
                onClick={() => {
                  onChange(tok)
                  setOpen(false)
                }}
                className={`h-8 rounded-lg ring-1 ring-black/10 ${value === tok ? 'outline outline-2 outline-sky-500 outline-offset-1' : ''}`}
                style={{ background: `var(--lhp-${tok.slice(1)}, #ccc)` }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input type="color" aria-label={t('landingBuilder.style.pick_color')} className="h-8 w-10 flex-none cursor-pointer rounded-lg border-0 bg-transparent p-0" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
            <input
              className={FIELD}
              placeholder="#1e293b"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cssColor(hex.trim())) {
                  onChange(hex.trim())
                  setOpen(false)
                }
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['#ffffff', '#000000', 'transparent', 'rgba(0,0,0,0.5)'].map((c) => (
              <button key={c} type="button" onClick={() => { onChange(c); setOpen(false) }} className="rounded-md px-2 py-1 text-[11px] text-neutral-600 bg-neutral-100 hover:bg-neutral-200">{c}</button>
            ))}
            {allowNone && value && (
              <button type="button" onClick={() => { onChange(undefined); setOpen(false) }} className="ms-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50">
                <X size={11} /> {t('landingBuilder.style.clear')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** An image: upload to the org's landing media, or paste a link. */
export function ImageInput({ value, onChange, accept = 'image' }: { value: string; onChange: (v: string) => void; accept?: 'image' | 'video' }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const [busy, setBusy] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const upload = async (file: File) => {
    const { validateFile } = await import('@/lib/file-validation')
    const check = validateFile(file, [accept])
    if (!check.valid) {
      toast.error(check.error || t('landingBuilder.media.upload_failed'))
      return
    }
    setBusy(true)
    try {
      const res = await uploadLandingContent(org.id, file, session?.data?.tokens?.access_token)
      if (res.status === 200) onChange(getOrgLandingMediaDirectory(org.org_uuid, res.data.filename))
      else toast.error(t('landingBuilder.media.upload_failed'))
    } catch {
      toast.error(t('landingBuilder.media.upload_failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      {value && accept === 'image' && (
        <div className="relative overflow-hidden rounded-lg ring-1 ring-neutral-200 bg-neutral-50">
          <img src={value} alt="" className="h-24 w-full object-cover" />
          <button type="button" onClick={() => onChange('')} aria-label={t('landingBuilder.style.clear')} className="absolute top-1.5 end-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-neutral-600 nice-shadow hover:text-rose-600">
            <X size={12} />
          </button>
        </div>
      )}
      <div className="flex gap-1.5">
        <input className={FIELD} value={value || ''} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex h-8 flex-none items-center gap-1 rounded-lg bg-white px-2.5 text-[12px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
        >
          <UploadSimple size={13} />
          {busy ? t('landingBuilder.media.uploading') : t('landingBuilder.media.upload')}
        </button>
        <input
          ref={input}
          type="file"
          className="hidden"
          accept={accept === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) upload(f)
          }}
        />
      </div>
    </div>
  )
}
