'use client'
import React from 'react'
import {
  LandingBackground,
  LandingButton,
  LandingCtaSection,
  LandingFaqSection,
  LandingBannerSection,
  LandingColumnsSection,
  LandingCountdownSection,
  LandingEmbedSection,
  LandingFeaturesSection,
  LandingGallerySection,
  LandingHeroSection,
  LandingImageSection,
  LandingPageSettings,
  LandingPricingSection,
  LandingStepsSection,
  LandingRichTextSection,
  LandingSection,
  LandingSectionStyle,
  LandingSpacerSection,
  LandingStatsSection,
  LandingTestimonialsSection,
  LandingVisibility,
} from './landing_types'
import { ArrowDown, ArrowUp, ShoppingBag, BadgeDollarSign, Columns3, Flag, Globe, ImageIcon, ListOrdered, SlidersHorizontal, Timer, HelpCircle, Images, LayoutGrid, Megaphone, Minus, Plus, Quote, Settings2, Trash2, TrendingUp, Type } from 'lucide-react'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Label } from '@components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Button } from '@components/ui/button'
import { Switch } from '@components/ui/switch'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { getPublicOffers } from '@services/payments/offers'
import { formatCurrency } from '@/lib/format'
import { ImageUploader } from './LandingImageUploader'
import { LandingOffer, resolveLandingEmbed, sanitizeAnchor } from '@components/Landings/landingSections'

const K = 'dashboard.organization.landing.blocks'

interface EditorProps<T> {
  section: T
  onChange: (section: T) => void
}

const Card: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
    <div className="flex items-center space-x-2">
      <Icon className="w-5 h-5 text-gray-500" />
      <h3 className="font-medium text-lg">{title}</h3>
    </div>
    <div className="space-y-4">{children}</div>
  </div>
)

const Field: React.FC<{ id: string; label: string; children: React.ReactNode }> = ({ id, label, children }) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
)

const ColorField: React.FC<{ id: string; label: string; value: string; onChange: (value: string) => void }> = ({ id, label, value, onChange }) => (
  <Field id={id} label={label}>
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 rounded-md border border-gray-200 bg-white p-1 cursor-pointer"
      />
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="#000000" />
    </div>
  </Field>
)

/** Add / remove / reorder rows of a repeated item. */
function ItemList<T>({
  items,
  onChange,
  empty,
  addLabel,
  max = 24,
  renderItem,
}: {
  items: T[]
  onChange: (items: T[]) => void
  empty: T
  addLabel: string
  max?: number
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode
}) {
  const { t } = useTranslation()
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="flex gap-3 p-4 border rounded-lg bg-gray-50/50">
          <div className="flex-1 space-y-2">
            {renderItem(item, (patch) => onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it))), index)}
          </div>
          <div className="flex flex-col gap-1">
            <Button variant="ghost" size="icon" aria-label={t(`${K}.move_up`)} disabled={index === 0} onClick={() => move(index, index - 1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t(`${K}.move_down`)} disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t(`${K}.remove`)} className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      {items.length < max && (
        <Button variant="outline" className="w-full" onClick={() => onChange([...items, { ...empty }])}>
          <Plus className="h-4 w-4 me-2" />
          {addLabel}
        </Button>
      )}
    </div>
  )
}

const ColumnsField: React.FC<{ value: number; onChange: (value: 2 | 3 | 4) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation()
  return (
    <Field id="block-columns" label={t(`${K}.columns`)}>
      <Select value={String(value || 3)} onValueChange={(v) => onChange(Number(v) as 2 | 3 | 4)}>
        <SelectTrigger id="block-columns"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="2">2</SelectItem>
          <SelectItem value="3">3</SelectItem>
          <SelectItem value="4">4</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}

const BackgroundField: React.FC<{
  idPrefix: string
  value?: LandingBackground
  allowNone?: boolean
  onChange: (value?: LandingBackground) => void
}> = ({ idPrefix, value, allowNone, onChange }) => {
  const { t } = useTranslation()
  const type = value?.type || (allowNone ? 'none' : 'solid')
  return (
    <div className="space-y-3">
      <Field id={`${idPrefix}-background-type`} label={t(`${K}.background`)}>
        <Select
          value={type}
          onValueChange={(next) => {
            if (next === 'none') onChange(undefined)
            else if (next === 'solid') onChange({ type: 'solid', color: value?.color || '#f8fafc' })
            else if (next === 'gradient') onChange({ type: 'gradient', colors: value?.colors?.length === 2 ? value.colors : ['#0f172a', '#1e3a8a'], direction: value?.direction || '135deg' })
            else onChange({ type: 'image', image: value?.image || '' })
          }}
        >
          <SelectTrigger id={`${idPrefix}-background-type`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {allowNone && <SelectItem value="none">{t(`${K}.background_none`)}</SelectItem>}
            <SelectItem value="solid">{t(`${K}.background_solid`)}</SelectItem>
            <SelectItem value="gradient">{t(`${K}.background_gradient`)}</SelectItem>
            <SelectItem value="image">{t(`${K}.background_image`)}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {value?.type === 'solid' && (
        <ColorField id={`${idPrefix}-background-color`} label={t(`${K}.color`)} value={value.color || ''} onChange={(color) => onChange({ ...value, color })} />
      )}
      {value?.type === 'gradient' && (
        <div className="grid grid-cols-2 gap-3">
          <ColorField id={`${idPrefix}-gradient-from`} label={t(`${K}.gradient_from`)} value={value.colors?.[0] || ''} onChange={(color) => onChange({ ...value, colors: [color, value.colors?.[1] || color] })} />
          <ColorField id={`${idPrefix}-gradient-to`} label={t(`${K}.gradient_to`)} value={value.colors?.[1] || ''} onChange={(color) => onChange({ ...value, colors: [value.colors?.[0] || color, color] })} />
        </div>
      )}
      {value?.type === 'image' && (
        <div className="space-y-2">
          <Input value={value.image || ''} onChange={(e) => onChange({ ...value, image: e.target.value })} placeholder="https://" />
          <ImageUploader id={`${idPrefix}-background`} onImageUploaded={(image) => onChange({ ...value, image })} buttonText={t(`${K}.upload_image`)} />
        </div>
      )}
    </div>
  )
}

const ButtonsField: React.FC<{ buttons: LandingButton[]; onChange: (buttons: LandingButton[]) => void }> = ({ buttons, onChange }) => {
  const { t } = useTranslation()
  return (
    <div>
      <Label>{t(`${K}.buttons`)}</Label>
      <div className="mt-2">
        <ItemList
          items={buttons}
          onChange={onChange}
          max={3}
          empty={{ text: t(`${K}.button_text_default`), link: '/courses', color: '#0f172a', background: '#ffffff' }}
          addLabel={t(`${K}.add_button`)}
          renderItem={(button, update) => (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input value={button.text} onChange={(e) => update({ text: e.target.value })} placeholder={t(`${K}.button_text`)} />
                <Input value={button.link} onChange={(e) => update({ link: e.target.value })} placeholder="/courses, #faq, https://" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ColorField id="" label={t(`${K}.button_background`)} value={button.background} onChange={(background) => update({ background })} />
                <ColorField id="" label={t(`${K}.button_color`)} value={button.color} onChange={(color) => update({ color })} />
              </div>
            </>
          )}
        />
      </div>
    </div>
  )
}

/** Visibility, draft toggle and presentation settings shared by every section type. */
export const SectionSettingsEditor: React.FC<EditorProps<LandingSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const style: LandingSectionStyle = section.style || {}
  const setStyle = (patch: Partial<LandingSectionStyle>) => {
    const next = { ...style, ...patch }
    // Drop empty keys so an untouched section keeps no `style` at all.
    ;(Object.keys(next) as (keyof LandingSectionStyle)[]).forEach((key) => {
      if (next[key] === undefined || next[key] === '') delete next[key]
    })
    onChange({ ...section, style: Object.keys(next).length ? next : undefined })
  }

  return (
    <div className="p-6 bg-white rounded-lg nice-shadow space-y-5">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="flex items-center space-x-2">
            <Settings2 className="w-5 h-5 text-gray-500" />
            <h3 className="font-medium text-lg">{t('dashboard.organization.landing.visibility.title')}</h3>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t('dashboard.organization.landing.visibility.description')}</p>
        </div>
        <div className="w-56 shrink-0">
          <Select
            value={section.visibility || 'everyone'}
            onValueChange={(value) => onChange({ ...section, visibility: value as LandingVisibility })}
          >
            <SelectTrigger id="section-visibility" aria-label={t('dashboard.organization.landing.visibility.title')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">{t('dashboard.organization.landing.visibility.everyone')}</SelectItem>
              <SelectItem value="logged_in">{t('dashboard.organization.landing.visibility.logged_in')}</SelectItem>
              <SelectItem value="logged_out">{t('dashboard.organization.landing.visibility.logged_out')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-6 border-t pt-4">
        <div>
          <Label htmlFor="section-hidden">{t(`${K}.hidden`)}</Label>
          <p className="text-sm text-gray-500">{t(`${K}.hidden_help`)}</p>
        </div>
        <Switch id="section-hidden" checked={!!section.hidden} onCheckedChange={(hidden) => onChange({ ...section, hidden: hidden || undefined })} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
        <Field id="section-device" label={t(`${K}.device`)}>
          <Select value={section.device || 'all'} onValueChange={(device) => onChange({ ...section, device: device === 'all' ? undefined : (device as LandingSection['device']) })}>
            <SelectTrigger id="section-device"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t(`${K}.device_all`)}</SelectItem>
              <SelectItem value="desktop">{t(`${K}.device_desktop`)}</SelectItem>
              <SelectItem value="mobile">{t(`${K}.device_mobile`)}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="section-show-from" label={t(`${K}.show_from`)}>
          <Input id="section-show-from" type="datetime-local" value={section.showFrom || ''} onChange={(e) => onChange({ ...section, showFrom: e.target.value || undefined })} />
        </Field>
        <Field id="section-show-until" label={t(`${K}.show_until`)}>
          <Input id="section-show-until" type="datetime-local" value={section.showUntil || ''} onChange={(e) => onChange({ ...section, showUntil: e.target.value || undefined })} />
        </Field>
      </div>

      <div className="border-t pt-4">
        <button type="button" id="section-style-toggle" onClick={() => setOpen(!open)} className="text-sm font-medium text-gray-700 hover:text-black" aria-expanded={open}>
          {open ? '−' : '+'} {t(`${K}.style`)}
        </button>
        {open && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
            <BackgroundField idPrefix="section" allowNone value={style.background} onChange={(background) => setStyle({ background })} />
            <div className="space-y-3">
              <ColorField id="section-text-color" label={t(`${K}.text_color`)} value={style.textColor || ''} onChange={(textColor) => setStyle({ textColor })} />
              <Field id="section-spacing" label={t(`${K}.spacing`)}>
                <Select value={style.spacing || 'medium'} onValueChange={(spacing) => setStyle({ spacing: spacing === 'medium' ? undefined : (spacing as LandingSectionStyle['spacing']) })}>
                  <SelectTrigger id="section-spacing"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t(`${K}.spacing_none`)}</SelectItem>
                    <SelectItem value="small">{t(`${K}.spacing_small`)}</SelectItem>
                    <SelectItem value="medium">{t(`${K}.spacing_medium`)}</SelectItem>
                    <SelectItem value="large">{t(`${K}.spacing_large`)}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field id="section-anchor" label={t(`${K}.anchor`)}>
                <Input id="section-anchor" value={style.anchor || ''} onChange={(e) => setStyle({ anchor: e.target.value })} placeholder="pricing" />
                <p className="text-xs text-gray-500 mt-1">
                  {t(`${K}.anchor_help`)} {sanitizeAnchor(style.anchor) ? <code>#{sanitizeAnchor(style.anchor)}</code> : null}
                </p>
              </Field>
            </div>
            <Field id="section-width" label={t(`${K}.width`)}>
              <Select value={style.width || 'normal'} onValueChange={(width) => setStyle({ width: width === 'narrow' ? 'narrow' : undefined })}>
                <SelectTrigger id="section-width"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">{t(`${K}.width_normal`)}</SelectItem>
                  <SelectItem value="narrow">{t(`${K}.width_narrow`)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="section-title-align" label={t(`${K}.title_align`)}>
              <Select value={style.titleAlign || 'start'} onValueChange={(align) => setStyle({ titleAlign: align === 'center' ? 'center' : undefined })}>
                <SelectTrigger id="section-title-align"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="start">{t(`${K}.align_start`)}</SelectItem>
                  <SelectItem value="center">{t(`${K}.align_center`)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="section-animation" label={t(`${K}.animation`)}>
              <Select value={style.animation || 'none'} onValueChange={(animation) => setStyle({ animation: animation === 'none' ? undefined : (animation as LandingSectionStyle['animation']) })}>
                <SelectTrigger id="section-animation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t(`${K}.animation_none`)}</SelectItem>
                  <SelectItem value="fade">{t(`${K}.animation_fade`)}</SelectItem>
                  <SelectItem value="slide-up">{t(`${K}.animation_slide_up`)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}

export const RichTextEditor: React.FC<EditorProps<LandingRichTextSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Type} title={t(`${K}.rich_text.title`)}>
      <Field id="rich-text-title" label={t(`${K}.title_label`)}>
        <Input id="rich-text-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <Field id="rich-text-content" label={t(`${K}.rich_text.content`)}>
        <Textarea id="rich-text-content" value={section.content} onChange={(e) => onChange({ ...section, content: e.target.value })} className="min-h-[180px] font-mono text-sm" />
        <p className="text-xs text-gray-500 mt-1">{t(`${K}.rich_text.markdown_help`)}</p>
      </Field>
      <Field id="rich-text-align" label={t(`${K}.align`)}>
        <Select value={section.align || 'left'} onValueChange={(align) => onChange({ ...section, align: align as 'left' | 'center' })}>
          <SelectTrigger id="rich-text-align"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">{t(`${K}.align_start`)}</SelectItem>
            <SelectItem value="center">{t(`${K}.align_center`)}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </Card>
  )
}

export const FeaturesEditor: React.FC<EditorProps<LandingFeaturesSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={LayoutGrid} title={t(`${K}.features.title`)}>
      <Field id="features-title" label={t(`${K}.title_label`)}>
        <Input id="features-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <Field id="features-subtitle" label={t(`${K}.subtitle_label`)}>
        <Input id="features-subtitle" value={section.subtitle} onChange={(e) => onChange({ ...section, subtitle: e.target.value })} />
      </Field>
      <ColumnsField value={section.columns} onChange={(columns) => onChange({ ...section, columns })} />
      <ItemList
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        empty={{ icon: '✨', title: '', description: '' }}
        addLabel={t(`${K}.features.add`)}
        renderItem={(item, update) => (
          <>
            <div className="grid grid-cols-[72px_1fr] gap-2">
              <Input value={item.icon} maxLength={4} onChange={(e) => update({ icon: e.target.value })} placeholder="✨" aria-label={t(`${K}.features.icon`)} className="text-center" />
              <Input value={item.title} onChange={(e) => update({ title: e.target.value })} placeholder={t(`${K}.title_label`)} />
            </div>
            <Textarea value={item.description} onChange={(e) => update({ description: e.target.value })} placeholder={t(`${K}.description_label`)} />
          </>
        )}
      />
    </Card>
  )
}

export const StatsEditor: React.FC<EditorProps<LandingStatsSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={TrendingUp} title={t(`${K}.stats.title`)}>
      <Field id="stats-title" label={t(`${K}.title_label`)}>
        <Input id="stats-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <ItemList
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        max={8}
        empty={{ value: '', label: '' }}
        addLabel={t(`${K}.stats.add`)}
        renderItem={(item, update) => (
          <div className="grid grid-cols-2 gap-2">
            <Input value={item.value} onChange={(e) => update({ value: e.target.value })} placeholder="12k+" aria-label={t(`${K}.stats.value`)} />
            <Input value={item.label} onChange={(e) => update({ label: e.target.value })} placeholder={t(`${K}.stats.label`)} />
          </div>
        )}
      />
    </Card>
  )
}

export const TestimonialsEditor: React.FC<EditorProps<LandingTestimonialsSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Quote} title={t(`${K}.testimonials.title`)}>
      <Field id="testimonials-title" label={t(`${K}.title_label`)}>
        <Input id="testimonials-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <ItemList
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        empty={{ quote: '', author: '', role: '', image_url: '' }}
        addLabel={t(`${K}.testimonials.add`)}
        renderItem={(item, update, index) => (
          <>
            <Textarea value={item.quote} onChange={(e) => update({ quote: e.target.value })} placeholder={t(`${K}.testimonials.quote`)} />
            <div className="grid grid-cols-2 gap-2">
              <Input value={item.author} onChange={(e) => update({ author: e.target.value })} placeholder={t(`${K}.testimonials.author`)} />
              <Input value={item.role} onChange={(e) => update({ role: e.target.value })} placeholder={t(`${K}.testimonials.role`)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={item.image_url} onChange={(e) => update({ image_url: e.target.value })} placeholder={t(`${K}.testimonials.photo_url`)} />
              <ImageUploader id={`testimonial-${index}`} onImageUploaded={(image_url) => update({ image_url })} buttonText={t(`${K}.upload_image`)} />
            </div>
          </>
        )}
      />
    </Card>
  )
}

export const FaqEditor: React.FC<EditorProps<LandingFaqSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={HelpCircle} title={t(`${K}.faq.title`)}>
      <Field id="faq-title" label={t(`${K}.title_label`)}>
        <Input id="faq-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <ItemList
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        empty={{ question: '', answer: '' }}
        addLabel={t(`${K}.faq.add`)}
        renderItem={(item, update) => (
          <>
            <Input value={item.question} onChange={(e) => update({ question: e.target.value })} placeholder={t(`${K}.faq.question`)} />
            <Textarea value={item.answer} onChange={(e) => update({ answer: e.target.value })} placeholder={t(`${K}.faq.answer`)} />
          </>
        )}
      />
    </Card>
  )
}

export const CtaEditor: React.FC<EditorProps<LandingCtaSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Megaphone} title={t(`${K}.cta.title`)}>
      <Field id="cta-heading" label={t(`${K}.cta.heading`)}>
        <Input id="cta-heading" value={section.heading} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
      </Field>
      <Field id="cta-text" label={t(`${K}.description_label`)}>
        <Textarea id="cta-text" value={section.text} onChange={(e) => onChange({ ...section, text: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BackgroundField idPrefix="cta" value={section.background} onChange={(background) => onChange({ ...section, background: background || { type: 'solid', color: '#0f172a' } })} />
        <ColorField id="cta-text-color" label={t(`${K}.text_color`)} value={section.textColor} onChange={(textColor) => onChange({ ...section, textColor })} />
      </div>
      <ButtonsField buttons={section.buttons} onChange={(buttons) => onChange({ ...section, buttons })} />
    </Card>
  )
}

export const GalleryEditor: React.FC<EditorProps<LandingGallerySection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Images} title={t(`${K}.gallery.title`)}>
      <Field id="gallery-title" label={t(`${K}.title_label`)}>
        <Input id="gallery-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <ColumnsField value={section.columns} onChange={(columns) => onChange({ ...section, columns })} />
      <ItemList
        items={section.images}
        onChange={(images) => onChange({ ...section, images })}
        empty={{ url: '', alt: '' }}
        addLabel={t(`${K}.gallery.add`)}
        renderItem={(image, update, index) => (
          <div className="flex gap-3">
            {image.url && <img src={image.url} alt={image.alt} className="w-20 h-14 rounded-md object-cover shrink-0" />}
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input value={image.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://" />
                <Input value={image.alt} onChange={(e) => update({ alt: e.target.value })} placeholder={t(`${K}.gallery.alt`)} />
              </div>
              <ImageUploader id={`gallery-${index}`} onImageUploaded={(url) => update({ url })} buttonText={t(`${K}.upload_image`)} />
            </div>
          </div>
        )}
      />
    </Card>
  )
}

export const SpacerEditor: React.FC<EditorProps<LandingSpacerSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Minus} title={t(`${K}.spacer.title`)}>
      <Field id="spacer-size" label={t(`${K}.spacer.size`)}>
        <Select value={section.size || 'medium'} onValueChange={(size) => onChange({ ...section, size: size as LandingSpacerSection['size'] })}>
          <SelectTrigger id="spacer-size"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="small">{t(`${K}.spacing_small`)}</SelectItem>
            <SelectItem value="medium">{t(`${K}.spacing_medium`)}</SelectItem>
            <SelectItem value="large">{t(`${K}.spacing_large`)}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-center justify-between">
        <Label htmlFor="spacer-divider">{t(`${K}.spacer.divider`)}</Label>
        <Switch id="spacer-divider" checked={!!section.divider} onCheckedChange={(divider) => onChange({ ...section, divider })} />
      </div>
    </Card>
  )
}

/** Extra hero options, shown under the hero editor so its tabs stay untouched. */
export const HeroExtrasEditor: React.FC<EditorProps<LandingHeroSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={SlidersHorizontal} title={t(`${K}.hero.title`)}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field id="hero-height" label={t(`${K}.hero.height`)}>
          <Select value={section.height || 'medium'} onValueChange={(height) => onChange({ ...section, height: height === 'medium' ? undefined : (height as LandingHeroSection['height']) })}>
            <SelectTrigger id="hero-height"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="small">{t(`${K}.spacing_small`)}</SelectItem>
              <SelectItem value="medium">{t(`${K}.spacing_medium`)}</SelectItem>
              <SelectItem value="large">{t(`${K}.spacing_large`)}</SelectItem>
              <SelectItem value="screen">{t(`${K}.hero.height_screen`)}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="hero-overlay" label={`${t(`${K}.hero.overlay`)} (${section.overlay || 0}%)`}>
          <input
            id="hero-overlay"
            type="range"
            min={0}
            max={80}
            step={5}
            value={section.overlay || 0}
            onChange={(e) => onChange({ ...section, overlay: Number(e.target.value) || undefined })}
            className="w-full mt-3"
          />
          <p className="text-xs text-gray-500 mt-1">{t(`${K}.hero.overlay_help`)}</p>
        </Field>
      </div>
    </Card>
  )
}

export const PricingEditor: React.FC<EditorProps<LandingPricingSection>> = ({ section, onChange }) => {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  // The public listing, because those are the offers a visitor can actually buy.
  const { data: offers = [] } = useQuery<LandingOffer[]>({
    queryKey: ['landing-public-offers', org?.id],
    queryFn: async () => {
      try {
        const result = await getPublicOffers(org.id)
        return result?.success && Array.isArray(result.data) ? result.data : []
      } catch {
        return []
      }
    },
    enabled: !!org?.id,
    staleTime: 60_000,
  })
  const offerLabel = (offer: LandingOffer) => `${offer.name} · ${formatCurrency(offer.amount, offer.currency, i18n.language)}`
  const unlinkedOffers = offers.filter((offer) => !section.plans.some((plan) => plan.offer_uuid === offer.offer_uuid))

  const addPlansFromStore = () => {
    const plans = unlinkedOffers.slice(0, Math.max(0, 4 - section.plans.length)).map((offer) => ({
      name: '', price: '', period: '', description: '', features: '', highlighted: false,
      offer_uuid: offer.offer_uuid,
      button: { text: t(`${K}.pricing.buy_default`), link: '', color: '#ffffff', background: '#0f172a' },
    }))
    onChange({ ...section, plans: [...section.plans, ...plans] })
  }

  return (
    <Card icon={BadgeDollarSign} title={t(`${K}.pricing.title`)}>
      <Field id="pricing-title" label={t(`${K}.title_label`)}>
        <Input id="pricing-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <Field id="pricing-subtitle" label={t(`${K}.subtitle_label`)}>
        <Input id="pricing-subtitle" value={section.subtitle} onChange={(e) => onChange({ ...section, subtitle: e.target.value })} />
      </Field>
      {offers.length > 0 ? (
        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-gray-50 border">
          <p className="text-sm text-gray-600 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 shrink-0" />
            {t(`${K}.pricing.store_hint`)}
          </p>
          <Button id="pricing-add-from-store" variant="outline" disabled={unlinkedOffers.length === 0 || section.plans.length >= 4} onClick={addPlansFromStore}>
            {t(`${K}.pricing.add_from_store`)}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">{t(`${K}.pricing.store_empty`)}</p>
      )}
      <ItemList
        items={section.plans}
        onChange={(plans) => onChange({ ...section, plans })}
        max={4}
        empty={{ name: '', price: '', period: '', description: '', features: '', highlighted: false, button: { text: t(`${K}.pricing.button_default`), link: '/signup', color: '#ffffff', background: '#0f172a' } }}
        addLabel={t(`${K}.pricing.add`)}
        renderItem={(plan, update, index) => {
          const linked = offers.find((offer) => offer.offer_uuid === plan.offer_uuid)
          return (
          <>
            {(offers.length > 0 || plan.offer_uuid) && (
              <div>
                <Label htmlFor={`pricing-offer-${index}`}>{t(`${K}.pricing.linked_offer`)}</Label>
                <Select value={plan.offer_uuid || 'none'} onValueChange={(value) => update({ offer_uuid: value === 'none' ? undefined : value })}>
                  <SelectTrigger id={`pricing-offer-${index}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t(`${K}.pricing.linked_none`)}</SelectItem>
                    {offers.map((offer) => (
                      <SelectItem key={offer.offer_uuid} value={offer.offer_uuid}>{offerLabel(offer)}</SelectItem>
                    ))}
                    {plan.offer_uuid && !linked && (
                      <SelectItem value={plan.offer_uuid}>{t(`${K}.pricing.linked_missing`)}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {plan.offer_uuid && (
                  <p className={`text-xs mt-1 ${linked ? 'text-gray-500' : 'text-amber-700'}`}>
                    {t(linked ? `${K}.pricing.linked_help` : `${K}.pricing.linked_missing_help`)}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Input value={plan.name} onChange={(e) => update({ name: e.target.value })} placeholder={linked?.name || t(`${K}.pricing.name`)} />
              <Input
                value={linked ? formatCurrency(linked.amount, linked.currency, i18n.language) : plan.price}
                disabled={!!linked}
                onChange={(e) => update({ price: e.target.value })}
                placeholder="$29"
                aria-label={t(`${K}.pricing.price`)}
              />
              <Input value={plan.period} onChange={(e) => update({ period: e.target.value })} placeholder={t(`${K}.pricing.period`)} />
            </div>
            <Input value={plan.description} onChange={(e) => update({ description: e.target.value })} placeholder={t(`${K}.description_label`)} />
            <Textarea value={plan.features} onChange={(e) => update({ features: e.target.value })} placeholder={t(`${K}.pricing.features`)} className="min-h-[90px]" />
            <div className="grid grid-cols-2 gap-2">
              <Input value={plan.button.text} onChange={(e) => update({ button: { ...plan.button, text: e.target.value } })} placeholder={t(`${K}.button_text`)} />
              <Input
                value={plan.offer_uuid ? `/store/offers/${plan.offer_uuid}` : plan.button.link}
                disabled={!!plan.offer_uuid}
                onChange={(e) => update({ button: { ...plan.button, link: e.target.value } })}
                placeholder="/signup, https://"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id={`pricing-highlight-${index}`} checked={!!plan.highlighted} onCheckedChange={(highlighted) => update({ highlighted })} />
              <Label htmlFor={`pricing-highlight-${index}`}>{t(`${K}.pricing.highlighted`)}</Label>
            </div>
          </>
          )
        }}
      />
    </Card>
  )
}

export const StepsEditor: React.FC<EditorProps<LandingStepsSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={ListOrdered} title={t(`${K}.steps.title`)}>
      <Field id="steps-title" label={t(`${K}.title_label`)}>
        <Input id="steps-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <Field id="steps-layout" label={t(`${K}.steps.layout`)}>
        <Select value={section.layout || 'horizontal'} onValueChange={(layout) => onChange({ ...section, layout: layout as LandingStepsSection['layout'] })}>
          <SelectTrigger id="steps-layout"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="horizontal">{t(`${K}.steps.horizontal`)}</SelectItem>
            <SelectItem value="vertical">{t(`${K}.steps.vertical`)}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <ItemList
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        max={8}
        empty={{ title: '', description: '' }}
        addLabel={t(`${K}.steps.add`)}
        renderItem={(item, update) => (
          <>
            <Input value={item.title} onChange={(e) => update({ title: e.target.value })} placeholder={t(`${K}.title_label`)} />
            <Textarea value={item.description} onChange={(e) => update({ description: e.target.value })} placeholder={t(`${K}.description_label`)} />
          </>
        )}
      />
    </Card>
  )
}

export const ColumnsEditor: React.FC<EditorProps<LandingColumnsSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Columns3} title={t(`${K}.columns_block.title`)}>
      <Field id="columns-title" label={t(`${K}.title_label`)}>
        <Input id="columns-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <p className="text-xs text-gray-500">{t(`${K}.rich_text.markdown_help`)}</p>
      <ItemList
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        max={4}
        empty={{ content: '' }}
        addLabel={t(`${K}.columns_block.add`)}
        renderItem={(item, update) => (
          <Textarea value={item.content} onChange={(e) => update({ content: e.target.value })} className="min-h-[120px] font-mono text-sm" placeholder={'### Heading\nText'} />
        )}
      />
    </Card>
  )
}

export const ImageEditor: React.FC<EditorProps<LandingImageSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={ImageIcon} title={t(`${K}.image.title`)}>
      <div className="grid grid-cols-2 gap-2">
        <Input value={section.image.url} onChange={(e) => onChange({ ...section, image: { ...section.image, url: e.target.value } })} placeholder="https://" />
        <Input value={section.image.alt} onChange={(e) => onChange({ ...section, image: { ...section.image, alt: e.target.value } })} placeholder={t(`${K}.gallery.alt`)} />
      </div>
      <ImageUploader id="image-section" onImageUploaded={(url) => onChange({ ...section, image: { ...section.image, url } })} buttonText={t(`${K}.upload_image`)} />
      {section.image.url && <img src={section.image.url} alt={section.image.alt} className="max-h-48 rounded-lg object-cover" />}
      <Field id="image-caption" label={t(`${K}.image.caption`)}>
        <Input id="image-caption" value={section.caption} onChange={(e) => onChange({ ...section, caption: e.target.value })} />
      </Field>
      <Field id="image-link" label={t(`${K}.image.link`)}>
        <Input id="image-link" value={section.link} onChange={(e) => onChange({ ...section, link: e.target.value })} placeholder="/courses, https://" />
      </Field>
      <div className="flex items-center justify-between">
        <Label htmlFor="image-rounded">{t(`${K}.image.rounded`)}</Label>
        <Switch id="image-rounded" checked={!!section.rounded} onCheckedChange={(rounded) => onChange({ ...section, rounded })} />
      </div>
    </Card>
  )
}

export const EmbedEditor: React.FC<EditorProps<LandingEmbedSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  const invalid = !!section.url.trim() && !resolveLandingEmbed(section.url)
  return (
    <Card icon={Globe} title={t(`${K}.embed.title`)}>
      <Field id="embed-title" label={t(`${K}.title_label`)}>
        <Input id="embed-title" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <Field id="embed-url" label={t(`${K}.embed.url`)}>
        <Input id="embed-url" value={section.url} onChange={(e) => onChange({ ...section, url: e.target.value })} placeholder="https://calendly.com/..." aria-invalid={invalid} />
        <p className={`text-xs mt-1 ${invalid ? 'text-red-600' : 'text-gray-500'}`}>{t(invalid ? `${K}.embed.not_allowed` : `${K}.embed.help`)}</p>
      </Field>
      <Field id="embed-height" label={t(`${K}.embed.height`)}>
        <Input id="embed-height" type="number" min={200} max={1600} step={50} value={section.height || 600} onChange={(e) => onChange({ ...section, height: Number(e.target.value) || 600 })} />
      </Field>
    </Card>
  )
}

export const BannerEditor: React.FC<EditorProps<LandingBannerSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Flag} title={t(`${K}.banner.title`)}>
      <Field id="banner-text" label={t(`${K}.banner.text`)}>
        <Input id="banner-text" value={section.text} onChange={(e) => onChange({ ...section, text: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field id="banner-link-text" label={t(`${K}.banner.link_text`)}>
          <Input id="banner-link-text" value={section.linkText} onChange={(e) => onChange({ ...section, linkText: e.target.value })} />
        </Field>
        <Field id="banner-link" label={t(`${K}.image.link`)}>
          <Input id="banner-link" value={section.link} onChange={(e) => onChange({ ...section, link: e.target.value })} placeholder="/courses, #pricing" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <ColorField id="banner-background" label={t(`${K}.background`)} value={section.background} onChange={(background) => onChange({ ...section, background })} />
        <ColorField id="banner-text-color" label={t(`${K}.text_color`)} value={section.textColor} onChange={(textColor) => onChange({ ...section, textColor })} />
      </div>
      <p className="text-xs text-gray-500">{t(`${K}.banner.schedule_tip`)}</p>
    </Card>
  )
}

export const CountdownEditor: React.FC<EditorProps<LandingCountdownSection>> = ({ section, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={Timer} title={t(`${K}.countdown.title`)}>
      <Field id="countdown-heading" label={t(`${K}.cta.heading`)}>
        <Input id="countdown-heading" value={section.heading} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
      </Field>
      <Field id="countdown-text" label={t(`${K}.description_label`)}>
        <Textarea id="countdown-text" value={section.text} onChange={(e) => onChange({ ...section, text: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field id="countdown-target" label={t(`${K}.countdown.target`)}>
          <Input id="countdown-target" type="datetime-local" value={section.target} onChange={(e) => onChange({ ...section, target: e.target.value })} />
        </Field>
        <Field id="countdown-done" label={t(`${K}.countdown.done_text`)}>
          <Input id="countdown-done" value={section.doneText} onChange={(e) => onChange({ ...section, doneText: e.target.value })} />
        </Field>
      </div>
      <ButtonsField buttons={section.buttons} onChange={(buttons) => onChange({ ...section, buttons })} />
    </Card>
  )
}

/** Page-wide settings: background, content width, gap between sections. */
export const PageSettingsEditor: React.FC<{ settings: LandingPageSettings; onChange: (settings: LandingPageSettings) => void }> = ({ settings, onChange }) => {
  const { t } = useTranslation()
  return (
    <Card icon={SlidersHorizontal} title={t(`${K}.page.title`)}>
      <p className="text-sm text-gray-500 -mt-3">{t(`${K}.page.description`)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BackgroundField idPrefix="page" allowNone value={settings.background} onChange={(background) => onChange({ ...settings, background })} />
        <div className="space-y-3">
          <Field id="page-width" label={t(`${K}.page.width`)}>
            <Select value={settings.width || 'normal'} onValueChange={(width) => onChange({ ...settings, width: width === 'wide' ? 'wide' : undefined })}>
              <SelectTrigger id="page-width"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">{t(`${K}.width_normal`)}</SelectItem>
                <SelectItem value="wide">{t(`${K}.page.width_wide`)}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="page-gap" label={t(`${K}.page.gap`)}>
            <Select value={settings.gap || 'none'} onValueChange={(gap) => onChange({ ...settings, gap: gap === 'none' ? undefined : (gap as LandingPageSettings['gap']) })}>
              <SelectTrigger id="page-gap"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t(`${K}.spacing_none`)}</SelectItem>
                <SelectItem value="small">{t(`${K}.spacing_small`)}</SelectItem>
                <SelectItem value="medium">{t(`${K}.spacing_medium`)}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
    </Card>
  )
}
