'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  CaretDown,
  CheckCircle,
  Circle,
  ListBullets,
  LinkSimple,
  Plus,
  TextB,
  TextItalic,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button, INPUT, Skeleton } from '@/design'
import { AccountInput, AccountLabel, AccountTextarea } from '@components/Objects/Account/AccountSection'
import { DETAIL_ICONS, DetailIcon, LinkKindIcon } from '@components/Objects/Profile/profileIcons'
import {
  DETAIL_TEMPLATES,
  LIMITS,
  applyDetailTemplate,
  linkKind,
  safeImageUrl,
  safeUrl,
  type DetailItem,
  type DetailTemplate,
  type FeaturedItem,
  type ProfileSection,
} from '@/lib/profile/profile'

// Editors for each profile builder section. Every editor is controlled: it
// gets the section (or the details list) and hands back a changed copy.

export type SectionEditorProps = { section: ProfileSection; onChange: (_s: ProfileSection) => void }

const rowRemove = (label: string, onClick: () => void) => (
  <Button variant="danger-ghost" size="icon" onClick={onClick} aria-label={label} title={label} icon={<Trash size={14} />} />
)

function update<T>(list: T[] | undefined, index: number, patch: Partial<T>): T[] {
  return (list ?? []).map((item, i) => (i === index ? { ...item, ...patch } : item))
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-1 flex items-center gap-1 text-xs font-medium text-rose-600">
      <WarningCircle size={13} weight="fill" className="shrink-0" />
      {children}
    </p>
  )
}

/** Native select with the input look and an optional leading icon. */
export function NativeSelect({
  value,
  onChange,
  options,
  ariaLabel,
  icon,
  className = '',
}: {
  value: string
  onChange: (_v: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      {icon && <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-500">{icon}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`${INPUT} appearance-none cursor-pointer truncate ${icon ? 'ps-9' : ''} pe-8`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown size={13} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400" />
    </div>
  )
}

// ─── Rich text ───────────────────────────────────────────────────────────────

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-7 h-7 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 flex items-center justify-center"
    >
      {children}
    </button>
  )
}

/** Textarea with a small toolbar for the profile's light markup. */
export function RichTextField({
  id,
  value,
  onChange,
  max,
  placeholder,
  rows = 5,
}: {
  id: string
  value: string
  onChange: (_v: string) => void
  max: number
  placeholder?: string
  rows?: number
}) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLTextAreaElement>(null)

  const wrap = (before: string, after = before, fallback = '') => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const selected = value.slice(s, e) || fallback
    const next = `${value.slice(0, s)}${before}${selected}${after}${value.slice(e)}`.slice(0, max)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + before.length, s + before.length + selected.length)
    })
  }
  const bullet = () => {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const next = `${value.slice(0, lineStart)}- ${value.slice(lineStart)}`.slice(0, max)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + 2, s + 2)
    })
  }
  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900/15 bg-white">
      <div className="flex items-center gap-0.5 px-1.5 pt-1.5">
        <ToolButton label={t('user.profile.builder.bold', { defaultValue: 'Bold' })} onClick={() => wrap('**', '**', t('user.profile.builder.bold', { defaultValue: 'Bold' }))}>
          <TextB size={15} weight="bold" />
        </ToolButton>
        <ToolButton label={t('user.profile.builder.italic', { defaultValue: 'Italic' })} onClick={() => wrap('*', '*', t('user.profile.builder.italic', { defaultValue: 'Italic' }))}>
          <TextItalic size={15} />
        </ToolButton>
        <ToolButton label={t('user.profile.builder.link', { defaultValue: 'Link' })} onClick={() => wrap('[', '](https://)', t('user.profile.builder.link_text', { defaultValue: 'link text' }))}>
          <LinkSimple size={15} />
        </ToolButton>
        <ToolButton label={t('user.profile.builder.list', { defaultValue: 'Bulleted list' })} onClick={bullet}>
          <ListBullets size={15} />
        </ToolButton>
        <span className="ms-auto pe-1.5 text-[11px] tabular-nums text-neutral-400">{max - value.length}</span>
      </div>
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        dir="auto"
        className="block w-full resize-y bg-transparent px-3 pb-2.5 pt-1.5 text-sm placeholder:text-neutral-400 focus:outline-none"
      />
    </div>
  )
}

export function TextEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  return (
    <div>
      <AccountLabel htmlFor={`${section.id}-content`}>{t('user.settings.profile_builder.editors.text.content')}</AccountLabel>
      <RichTextField
        id={`${section.id}-content`}
        value={section.content ?? ''}
        onChange={(content) => onChange({ ...section, content })}
        max={LIMITS.text}
        placeholder={t('user.settings.profile_builder.editors.text.enter_content')}
        rows={7}
      />
    </div>
  )
}

// ─── Details ─────────────────────────────────────────────────────────────────

export function DetailsEditor({ details, onChange }: { details: DetailItem[]; onChange: (_d: DetailItem[]) => void }) {
  const { t } = useTranslation()
  const iconOptions = [
    { value: '', label: t('user.settings.general.select_icon') },
    ...DETAIL_ICONS.map((i) => ({ value: i.name, label: t(i.labelKey) })),
  ]
  const label = (id: string, fallback: string) => t(`user.settings.general.labels.${id.replace('-', '_')}`, { defaultValue: fallback })
  return (
    <div className="space-y-3">
      {details.length > 0 ? (
        <ul className="divide-y divide-neutral-100">
          {details.map((d, i) => (
            <li
              key={d.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,9rem)_minmax(0,9rem)_minmax(0,1fr)_auto] gap-2 items-center py-2.5 first:pt-0 last:pb-0"
            >
              <AccountInput
                value={d.label}
                maxLength={80}
                onChange={(e) => onChange(update(details, i, { label: e.target.value }))}
                placeholder={t('user.settings.general.detail_label_placeholder')}
                aria-label={t('user.settings.general.detail_label_placeholder')}
                dir="auto"
              />
              <div className="sm:order-last">{rowRemove(t('user.settings.general.remove'), () => onChange(details.filter((_, j) => j !== i)))}</div>
              <NativeSelect
                className="col-span-2 sm:col-span-1"
                value={d.icon}
                onChange={(icon) => onChange(update(details, i, { icon }))}
                options={iconOptions}
                ariaLabel={t('user.settings.general.icon')}
                icon={<DetailIcon name={d.icon} size={15} />}
              />
              <AccountInput
                className="col-span-2 sm:col-span-1"
                value={d.text}
                maxLength={300}
                onChange={(e) => onChange(update(details, i, { text: e.target.value }))}
                placeholder={t('user.settings.general.text_placeholder')}
                aria-label={t('user.settings.general.text')}
                dir="auto"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">
          {t('account.details_empty', { defaultValue: 'Add a title, a location or links to show on your profile.' })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          icon={<Plus size={12} weight="bold" />}
          onClick={() => onChange([...details, { id: `detail-${Date.now().toString(36)}`, label: '', icon: '', text: '' }])}
        >
          {t('user.settings.general.add_detail')}
        </Button>
        {(Object.keys(DETAIL_TEMPLATES) as DetailTemplate[]).map((key) => (
          <Button key={key} size="sm" variant="ghost" onClick={() => onChange(applyDetailTemplate(details, key, label))}>
            {t(`user.settings.general.add_${key}`)}
          </Button>
        ))}
        {details.length > 0 && (
          <Button size="sm" variant="danger-ghost" className="ms-auto" onClick={() => onChange([])}>
            {t('user.settings.general.clear_all')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Links ───────────────────────────────────────────────────────────────────

export function LinksEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const links = section.links ?? []
  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {links.map((l, i) => {
          const href = safeUrl(l.url)
          const invalid = !!(l.url.trim() || l.title.trim()) && !href
          return (
            <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,10rem)_minmax(0,1fr)_auto] gap-2 items-start">
              <span className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">
                <LinkKindIcon kind={linkKind(href)} size={16} />
              </span>
              <AccountInput
                value={l.title}
                maxLength={120}
                onChange={(e) => onChange({ ...section, links: update(links, i, { title: e.target.value }) })}
                placeholder={t('user.settings.profile_builder.editors.links.link_title')}
                aria-label={t('user.settings.profile_builder.editors.links.link_title')}
                dir="auto"
              />
              <div className="sm:order-last">
                {rowRemove(t('user.settings.general.remove'), () => onChange({ ...section, links: links.filter((_, j) => j !== i) }))}
              </div>
              <div className="col-span-3 sm:col-span-1 min-w-0">
                <AccountInput
                  value={l.url}
                  inputMode="url"
                  dir="ltr"
                  maxLength={2048}
                  aria-invalid={invalid || undefined}
                  className={invalid ? 'ring-rose-300' : ''}
                  onChange={(e) => onChange({ ...section, links: update(links, i, { url: e.target.value }) })}
                  placeholder="https://"
                  aria-label={t('user.settings.profile_builder.editors.links.url')}
                />
                {invalid && <FieldError>{t('user.profile.builder.invalid_url', { defaultValue: 'Use a web address (https://…) or an email address.' })}</FieldError>}
              </div>
            </li>
          )
        })}
      </ul>
      <Button size="sm" icon={<Plus size={12} weight="bold" />} onClick={() => onChange({ ...section, links: [...links, { title: '', url: '' }] })}>
        {t('user.settings.profile_builder.editors.links.add_link')}
      </Button>
    </div>
  )
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export function SkillsEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const skills = section.skills ?? []
  const [draft, setDraft] = React.useState('')
  const levelOptions = [
    { value: '', label: t('user.settings.profile_builder.editors.skills.select_level') },
    ...(['beginner', 'intermediate', 'advanced', 'expert'] as const).map((l) => ({
      value: l,
      label: t(`user.settings.profile_builder.editors.skills.levels.${l}`),
    })),
  ]
  // Comma-separated names add several skills at once.
  const addDraft = () => {
    const names = draft.split(',').map((s) => s.trim()).filter(Boolean)
    if (!names.length) return
    const existing = new Set(skills.map((s) => s.name.toLowerCase()))
    const added = names.filter((n) => !existing.has(n.toLowerCase())).map((name) => ({ name: name.slice(0, 80), level: '' as const, category: '' }))
    onChange({ ...section, skills: [...skills, ...added].slice(0, LIMITS.items) })
    setDraft('')
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <AccountInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addDraft()
            }
          }}
          placeholder={t('user.profile.builder.skills_placeholder', { defaultValue: 'Add skills, separated by commas' })}
          aria-label={t('user.settings.profile_builder.editors.skills.skill_name')}
          dir="auto"
        />
        <Button onClick={addDraft} icon={<Plus size={12} weight="bold" />}>
          {t('common.add')}
        </Button>
      </div>
      {skills.length > 0 && (
        <ul className="divide-y divide-neutral-100">
          {skills.map((k, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,9rem)_auto] gap-2 items-center py-2 first:pt-0 last:pb-0">
              <AccountInput
                value={k.name}
                maxLength={80}
                onChange={(e) => onChange({ ...section, skills: update(skills, i, { name: e.target.value }) })}
                aria-label={t('user.settings.profile_builder.editors.skills.skill_name')}
                dir="auto"
              />
              <div className="sm:order-last">
                {rowRemove(t('user.settings.general.remove'), () => onChange({ ...section, skills: skills.filter((_, j) => j !== i) }))}
              </div>
              <NativeSelect
                value={k.level || ''}
                onChange={(level) => onChange({ ...section, skills: update(skills, i, { level: level as any }) })}
                options={levelOptions}
                ariaLabel={t('user.settings.profile_builder.editors.skills.select_level')}
              />
              <AccountInput
                value={k.category ?? ''}
                maxLength={80}
                onChange={(e) => onChange({ ...section, skills: update(skills, i, { category: e.target.value }) })}
                placeholder={t('user.settings.profile_builder.editors.skills.category')}
                aria-label={t('user.settings.profile_builder.editors.skills.category')}
                dir="auto"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Timeline (experience / education) ───────────────────────────────────────

const MONTH = /^\d{4}-\d{2}$/

/** Month picker that keeps older free-text dates editable as text. */
function DateInput({ value, onChange, label, disabled }: { value: string; onChange: (_v: string) => void; label: string; disabled?: boolean }) {
  const legacy = !!value && !MONTH.test(value)
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-neutral-500 mb-1">{label}</p>
      <AccountInput type={legacy ? 'text' : 'month'} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </div>
  )
}

function TimelineItemShell({ children, onRemove, removeLabel }: { children: React.ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <li className="relative rounded-xl ring-1 ring-neutral-200 p-3 sm:p-4">
      <div className="absolute top-2 end-2">{rowRemove(removeLabel, onRemove)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pe-9">{children}</div>
    </li>
  )
}

export function ExperienceEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const k = 'user.settings.profile_builder.editors.experience'
  const items = section.experiences ?? []
  const set = (i: number, patch: Partial<(typeof items)[number]>) => onChange({ ...section, experiences: update(items, i, patch) })
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((e, i) => (
          <TimelineItemShell key={i} removeLabel={t('user.settings.general.remove')} onRemove={() => onChange({ ...section, experiences: items.filter((_, j) => j !== i) })}>
            <AccountInput value={e.title} maxLength={120} onChange={(ev) => set(i, { title: ev.target.value })} placeholder={t(`${k}.role_placeholder`)} aria-label={t(`${k}.role_title`)} dir="auto" />
            <AccountInput value={e.organization} maxLength={120} onChange={(ev) => set(i, { organization: ev.target.value })} placeholder={t(`${k}.organization_placeholder`)} aria-label={t(`${k}.organization`)} dir="auto" />
            <DateInput label={t(`${k}.start_date`)} value={e.startDate} onChange={(v) => set(i, { startDate: v })} />
            <DateInput label={t(`${k}.end_date`)} value={e.current ? '' : e.endDate ?? ''} disabled={e.current} onChange={(v) => set(i, { endDate: v })} />
            <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none">
              <input type="checkbox" checked={e.current} onChange={(ev) => set(i, { current: ev.target.checked })} className="size-4 rounded accent-neutral-900" />
              {t(`${k}.current`)}
            </label>
            <AccountTextarea className="sm:col-span-2" rows={3} maxLength={2000} value={e.description} onChange={(ev) => set(i, { description: ev.target.value })} placeholder={t(`${k}.description_placeholder`)} aria-label={t(`${k}.description`)} dir="auto" />
          </TimelineItemShell>
        ))}
      </ul>
      <Button
        size="sm"
        icon={<Plus size={12} weight="bold" />}
        onClick={() => onChange({ ...section, experiences: [...items, { title: '', organization: '', startDate: '', endDate: '', current: false, description: '' }] })}
      >
        {t(`${k}.add_experience`)}
      </Button>
    </div>
  )
}

export function EducationEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const k = 'user.settings.profile_builder.editors.education'
  const items = section.education ?? []
  const set = (i: number, patch: Partial<(typeof items)[number]>) => onChange({ ...section, education: update(items, i, patch) })
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((e, i) => (
          <TimelineItemShell key={i} removeLabel={t('user.settings.general.remove')} onRemove={() => onChange({ ...section, education: items.filter((_, j) => j !== i) })}>
            <AccountInput className="sm:col-span-2" value={e.institution} maxLength={120} onChange={(ev) => set(i, { institution: ev.target.value })} placeholder={t(`${k}.institution_placeholder`)} aria-label={t(`${k}.institution`)} dir="auto" />
            <AccountInput value={e.degree} maxLength={120} onChange={(ev) => set(i, { degree: ev.target.value })} placeholder={t(`${k}.degree_placeholder`)} aria-label={t(`${k}.degree`)} dir="auto" />
            <AccountInput value={e.field} maxLength={120} onChange={(ev) => set(i, { field: ev.target.value })} placeholder={t(`${k}.field_placeholder`)} aria-label={t(`${k}.field`)} dir="auto" />
            <DateInput label={t(`${k}.start_date`)} value={e.startDate} onChange={(v) => set(i, { startDate: v })} />
            <DateInput label={t(`${k}.end_date`)} value={e.current ? '' : e.endDate ?? ''} disabled={e.current} onChange={(v) => set(i, { endDate: v })} />
            <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none">
              <input type="checkbox" checked={e.current} onChange={(ev) => set(i, { current: ev.target.checked })} className="size-4 rounded accent-neutral-900" />
              {t(`${k}.current`)}
            </label>
            <AccountTextarea className="sm:col-span-2" rows={2} maxLength={2000} value={e.description ?? ''} onChange={(ev) => set(i, { description: ev.target.value })} placeholder={t(`${k}.description_placeholder`)} aria-label={t(`${k}.description`)} dir="auto" />
          </TimelineItemShell>
        ))}
      </ul>
      <Button
        size="sm"
        icon={<Plus size={12} weight="bold" />}
        onClick={() => onChange({ ...section, education: [...items, { institution: '', degree: '', field: '', startDate: '', endDate: '', current: false, description: '' }] })}
      >
        {t(`${k}.add_education`)}
      </Button>
    </div>
  )
}

// ─── Affiliations ────────────────────────────────────────────────────────────

export function AffiliationEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const k = 'user.settings.profile_builder.editors.affiliation'
  const items = section.affiliations ?? []
  const set = (i: number, patch: Partial<(typeof items)[number]>) => onChange({ ...section, affiliations: update(items, i, patch) })
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((a, i) => {
          const invalid = !!a.logoUrl.trim() && !safeImageUrl(a.logoUrl)
          return (
            <TimelineItemShell key={i} removeLabel={t('user.settings.general.remove')} onRemove={() => onChange({ ...section, affiliations: items.filter((_, j) => j !== i) })}>
              <AccountInput value={a.name} maxLength={120} onChange={(ev) => set(i, { name: ev.target.value })} placeholder={t(`${k}.name_placeholder`)} aria-label={t(`${k}.name`)} dir="auto" />
              <div className="min-w-0">
                <AccountInput
                  value={a.logoUrl}
                  inputMode="url"
                  dir="ltr"
                  maxLength={2048}
                  aria-invalid={invalid || undefined}
                  className={invalid ? 'ring-rose-300' : ''}
                  onChange={(ev) => set(i, { logoUrl: ev.target.value })}
                  placeholder={t(`${k}.logo_url_placeholder`)}
                  aria-label={t(`${k}.logo_url`)}
                />
                {invalid && <FieldError>{t('user.profile.builder.invalid_image', { defaultValue: 'Use an image address that starts with https://' })}</FieldError>}
              </div>
              <AccountTextarea className="sm:col-span-2" rows={2} maxLength={1000} value={a.description} onChange={(ev) => set(i, { description: ev.target.value })} placeholder={t(`${k}.description_placeholder`)} aria-label={t(`${k}.description`)} dir="auto" />
            </TimelineItemShell>
          )
        })}
      </ul>
      <Button size="sm" icon={<Plus size={12} weight="bold" />} onClick={() => onChange({ ...section, affiliations: [...items, { name: '', description: '', logoUrl: '' }] })}>
        {t(`${k}.add_affiliation`)}
      </Button>
    </div>
  )
}

// ─── Gallery ─────────────────────────────────────────────────────────────────

export function GalleryEditor({ section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const k = 'user.settings.profile_builder.editors.image_gallery'
  const images = section.images ?? []
  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {images.map((m, i) => {
          const src = safeImageUrl(m.url)
          const invalid = !!m.url.trim() && !src
          return (
            <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-start">
              <span className="w-14 h-10 rounded-lg bg-neutral-100 overflow-hidden shrink-0">
                {src && <img src={src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                <div className="min-w-0">
                  <AccountInput
                    value={m.url}
                    inputMode="url"
                    dir="ltr"
                    maxLength={2048}
                    aria-invalid={invalid || undefined}
                    className={invalid ? 'ring-rose-300' : ''}
                    onChange={(e) => onChange({ ...section, images: update(images, i, { url: e.target.value }) })}
                    placeholder={t(`${k}.enter_image_url`)}
                    aria-label={t(`${k}.image_url`)}
                  />
                  {invalid && <FieldError>{t('user.profile.builder.invalid_image', { defaultValue: 'Use an image address that starts with https://' })}</FieldError>}
                </div>
                <AccountInput
                  value={m.caption ?? ''}
                  maxLength={200}
                  onChange={(e) => onChange({ ...section, images: update(images, i, { caption: e.target.value }) })}
                  placeholder={t(`${k}.image_caption`)}
                  aria-label={t(`${k}.caption`)}
                  dir="auto"
                />
              </div>
              {rowRemove(t('user.settings.general.remove'), () => onChange({ ...section, images: images.filter((_, j) => j !== i) }))}
            </li>
          )
        })}
      </ul>
      <Button size="sm" icon={<Plus size={12} weight="bold" />} onClick={() => onChange({ ...section, images: [...images, { url: '', caption: '' }] })}>
        {t(`${k}.add_image`)}
      </Button>
    </div>
  )
}

// ─── Featured ────────────────────────────────────────────────────────────────

export type FeaturedOption = { kind: FeaturedItem['kind']; id: string; label: string; meta?: string; thumb?: React.ReactNode }

/** Pick up to LIMITS.featured items among the ones the user actually has. */
export function FeaturedEditor({
  section,
  onChange,
  options,
  loading,
}: SectionEditorProps & { options: FeaturedOption[]; loading: boolean }) {
  const { t } = useTranslation()
  const items = section.items ?? []
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const picked = (o: FeaturedOption) => items.some((i) => i.kind === o.kind && i.id === o.id)
  const full = items.length >= LIMITS.featured
  const toggle = (o: FeaturedOption) =>
    onChange({
      ...section,
      items: picked(o) ? items.filter((i) => !(i.kind === o.kind && i.id === o.id)) : full ? items : [...items, { kind: o.kind, id: o.id }],
    })
  const groups: { kind: FeaturedItem['kind']; label: string }[] = [
    { kind: 'course', label: t('user.profile.builder.featured_courses', { defaultValue: 'Courses you created' }) },
    { kind: 'certificate', label: t('trail.achievements.certificates', 'Certificates') },
    { kind: 'badge', label: t('plays.badges.title') },
  ]
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}
      </div>
    )
  }
  if (!options.length) {
    return (
      <p className="text-sm text-neutral-500">
        {t('user.profile.builder.featured_empty', { defaultValue: 'Nothing to feature yet. Courses you create, certificates and badges you earn show up here.' })}
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-neutral-500">
          {t('user.profile.builder.featured_count', { defaultValue: '{{count}} of {{max}} picked', count: items.length, max: LIMITS.featured })}
        </p>
        {options.length > 8 && (
          <AccountInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('user.profile.builder.featured_search', { defaultValue: 'Filter' })}
            aria-label={t('user.profile.builder.featured_search', { defaultValue: 'Filter' })}
            className="sm:ms-auto sm:max-w-56"
          />
        )}
      </div>
      {groups.map((g) => {
        const q = query.trim().toLowerCase()
        const all = options.filter((o) => o.kind === g.kind && (!q || `${o.label} ${o.meta ?? ''}`.toLowerCase().includes(q)))
        if (!all.length) return null
        // Long lists show the picked items and the first few; the rest on demand.
        const open = expanded[g.kind] || !!q || all.length <= 6
        const list = open ? all : [...all.filter(picked), ...all.filter((o) => !picked(o))].slice(0, 6)
        return (
          <div key={g.kind}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">{g.label}</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map((o) => {
                const on = picked(o)
                return (
                  <li key={`${o.kind}-${o.id}`}>
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={!on && full}
                      onClick={() => toggle(o)}
                      className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        on ? 'bg-neutral-900/[0.04] ring-2 ring-neutral-900' : 'ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
                      }`}
                    >
                      {o.thumb}
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-medium text-neutral-800" dir="auto">{o.label}</span>
                        {o.meta && <span className="block truncate text-xs text-neutral-400" dir="auto">{o.meta}</span>}
                      </span>
                      {on ? <CheckCircle size={18} weight="fill" className="text-neutral-900 shrink-0" /> : <Circle size={18} className="text-neutral-300 shrink-0" />}
                    </button>
                  </li>
                )
              })}
            </ul>
            {!open && (
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [g.kind]: true }))}
                className="mt-2 text-xs font-semibold text-neutral-500 hover:text-neutral-900"
              >
                {t('user.profile.builder.show_all', { defaultValue: 'Show all ({{count}})', count: all.length })}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
