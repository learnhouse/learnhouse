'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Buildings, CloudArrowUp, X } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, Modal, SegmentedControl, TEXTAREA } from '@/design'
import { getDeploymentMode } from '@services/config/config'
import { createOrg, errorMessage, uploadOrgImage } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { PLANS } from '@services/ee/platform/types'
import { useAccessToken } from '@components/Admin/hooks'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import { checkerStyle } from '@components/Dashboard/Pages/Org/OrgEditBranding/BrandingShared'
import { normalizeHex } from '@components/Admin/OrgDetail/orgConfig'

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const LOGO_MAX_BYTES = 15 * 1024 * 1024 // the API cap for images

/** Final slug: diacritics folded (Ü → u), invalid runs become one hyphen, edges trimmed. */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** While typing: same folding, but a trailing hyphen survives so "my-org" can be typed. */
export function slugifyTyping(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)
}

export default function CreateOrganizationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const router = useRouter()
  const isSaaS = getDeploymentMode() === 'saas'

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [description, setDescription] = useState('')
  const [plan, setPlan] = useState<string>('free')
  // Optional starting setup: logo (uploaded right after the org exists), brand
  // color, default language and who can join.
  const [logo, setLogo] = useState<File | null>(null)
  const [logoError, setLogoError] = useState('')
  const [color, setColor] = useState('')
  const [language, setLanguage] = useState('en')
  const [signupMode, setSignupMode] = useState<'open' | 'inviteOnly'>('open')
  const logoInput = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
      setSlugTouched(false)
      setEmail('')
      setDescription('')
      setPlan('free')
      setError('')
      setSubmitting(false)
      setLogo(null)
      setLogoError('')
      setColor('')
      setLanguage('en')
      setSignupMode('open')
    }
  }, [open])

  // Object URL for the logo preview, released when it changes or closes.
  const logoUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo])
  useEffect(() => () => {
    if (logoUrl) URL.revokeObjectURL(logoUrl)
  }, [logoUrl])

  const pickLogo = (file?: File) => {
    if (!file) return
    // Same rules the API applies (no SVG, images only, size cap); checked here
    // so a bad file is caught before the org is created.
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError(t('admin.create_org.logo_type'))
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(t('admin.create_org.logo_size'))
      return
    }
    setLogoError('')
    setLogo(file)
  }

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  // The API is lenient here (it accepted empty and malformed values), so the
  // form checks what a working org needs before sending.
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugify(slug))
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const colorOk = normalizeHex(color) !== null
  const canSubmit = name.trim().length > 0 && slugOk && emailOk && colorOk && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const body: Record<string, unknown> = { name: name.trim(), slug: slugify(slug), email: email.trim() }
      if (description.trim()) body.description = description.trim()
      if (isSaaS) body.plan = plan
      if (normalizeHex(color)) body.color = normalizeHex(color)
      if (language !== 'en') body.default_language = language
      if (signupMode !== 'open') body.signup_mode = signupMode
      const data = await createOrg(token, body)
      if (data?.id && logo) {
        // The org exists either way; a failed logo upload is reported, not fatal.
        try {
          await uploadOrgImage(token, data.id, 'logo', logo)
        } catch (err) {
          toast.error(errorMessage(err, t('admin.create_org.logo_failed')))
        }
      }
      queryClient.invalidateQueries({ queryKey: platformKeys.orgs() })
      onClose()
      if (data?.id) router.push(`/admin/organizations/${data.id}`)
    } catch (err) {
      setError(errorMessage(err, t('admin.create_org.network_error')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      preventClose={submitting}
      size="md"
      icon={<Buildings size={18} />}
      dialogTitle={t('admin.create_org.title')}
      dialogDescription={t('admin.orgs.create_desc')}
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            {t('common.create_organization')}
          </Button>
        </>
      }
      dialogContent={
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <label className="block">
            <FieldLabel>{t('admin.create_org.name')}</FieldLabel>
            <input autoFocus className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.create_org.name_placeholder')} />
          </label>
          <label className="block">
            <FieldLabel hint={t('admin.create_org.slug_hint')} error={slug && !slugOk ? t('admin.create_org.slug_invalid') : undefined}>
              {t('admin.create_org.slug')}
            </FieldLabel>
            <input
              className={`${INPUT} font-mono`}
              dir="ltr"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(slugifyTyping(e.target.value))
              }}
              onBlur={() => setSlug((v) => slugify(v))}
              placeholder="acme-learning"
            />
          </label>
          <label className="block">
            <FieldLabel error={email.trim() && !emailOk ? t('admin.create_org.email_invalid') : undefined}>{t('admin.create_org.email')}</FieldLabel>
            <input type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@acme.com" />
          </label>
          <label className="block">
            <FieldLabel hint={t('common.optional')}>{t('admin.create_org.description')}</FieldLabel>
            <textarea rows={2} className={TEXTAREA} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {isSaaS && (
            <label className="block">
              <FieldLabel>{t('admin.create_org.plan')}</FieldLabel>
              <select className={INPUT} value={plan} onChange={(e) => setPlan(e.target.value)}>
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {t(`admin.plans.${p}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="flex flex-col gap-4 rounded-xl bg-neutral-50 p-3.5 ring-1 ring-inset ring-neutral-200/70">
            <legend className="sr-only">{t('admin.create_org.setup_title')}</legend>
            <div>
              <p className="text-sm font-semibold text-neutral-900">{t('admin.create_org.setup_title')}</p>
              <p className="text-xs text-neutral-500">{t('admin.create_org.setup_desc')}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                style={logoUrl ? checkerStyle : undefined}
                aria-label={logo ? t('admin.create_org.logo_replace') : t('admin.create_org.logo_add')}
                className={`h-16 w-28 shrink-0 overflow-hidden rounded-xl border flex items-center justify-center ${
                  logoUrl ? 'border-neutral-200' : 'border-dashed border-neutral-300 bg-white text-neutral-400 hover:bg-neutral-100'
                }`}
              >
                {logoUrl ? <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain p-2" /> : <CloudArrowUp size={20} weight="duotone" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-800">{t('admin.create_org.logo')}</p>
                <p className="text-xs text-neutral-500 truncate">{logo ? logo.name : t('admin.create_org.logo_hint')}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => logoInput.current?.click()}>
                    {logo ? t('admin.create_org.logo_replace') : t('admin.create_org.logo_add')}
                  </Button>
                  {logo && (
                    <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => setLogo(null)}>
                      {t('common.remove')}
                    </Button>
                  )}
                </div>
                {logoError && <p className="mt-1 text-xs font-medium text-rose-600">{logoError}</p>}
              </div>
              <input
                ref={logoInput}
                type="file"
                accept={LOGO_TYPES.join(',')}
                className="hidden"
                data-testid="create-org-logo"
                onChange={(e) => {
                  pickLogo(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <FieldLabel hint={t('common.optional')} error={!colorOk ? t('admin.create_org.color_invalid') : undefined}>
                  {t('admin.create_org.color')}
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={t('admin.create_org.color')}
                    value={normalizeHex(color) || '#ffffff'}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-neutral-200 bg-white p-0.5"
                  />
                  <input className={`${INPUT} font-mono`} dir="ltr" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#1d4ed8" />
                </div>
              </label>
              <label className="block">
                <FieldLabel>{t('admin.create_org.language')}</FieldLabel>
                <select className={INPUT} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {AVAILABLE_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code.toUpperCase()} · {l.nativeName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <FieldLabel hint={t('admin.org_detail.signup_mode_desc')}>{t('admin.org_detail.signup_mode')}</FieldLabel>
              <SegmentedControl
                value={signupMode}
                onChange={setSignupMode}
                ariaLabel={t('admin.org_detail.signup_mode')}
                options={[
                  { key: 'open', label: t('admin.org_detail.signup_open') },
                  { key: 'inviteOnly', label: t('admin.org_detail.signup_invite_only') },
                ]}
              />
            </div>
          </fieldset>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      }
    />
  )
}
