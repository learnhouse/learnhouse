'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import { Check, ChevronDown } from 'lucide-react'
import {
  LandingCtaSection,
  LandingFaqSection,
  LandingFeaturesSection,
  LandingBannerSection,
  LandingColumnsSection,
  LandingCountdownSection,
  LandingEmbedSection,
  LandingGallerySection,
  LandingImageSection,
  LandingPricingSection,
  LandingRichTextSection,
  LandingStepsSection,
  LandingSpacerSection,
  LandingStatsSection,
  LandingTestimonialsSection,
} from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import { backgroundCss, countdownParts, LandingOffer, resolveLandingEmbed, resolvePricingPlan, safeHref } from './landingSections'

const SECTION = 'mx-2 sm:mx-4 lg:mx-16 w-full'
const TITLE = 'text-2xl md:text-3xl font-bold mb-6'

const GRID_COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const

// The app has no typography plugin, so Markdown output is styled here.
const PROSE = [
  'text-base leading-relaxed text-inherit',
  '[&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3',
  '[&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3',
  '[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1',
  '[&_p]:my-2 [&_p]:opacity-80',
  '[&_ul]:list-disc [&_ul]:ps-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_ol]:my-2 [&_li]:my-1',
  '[&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold',
  '[&_blockquote]:border-s-4 [&_blockquote]:ps-4 [&_blockquote]:opacity-80',
  '[&_code]:bg-black/5 [&_code]:px-1 [&_code]:rounded',
  '[&>*:first-child]:mt-0',
].join(' ')

interface BlockProps<T> {
  section: T
  // Vertical padding class chosen by the section's spacing setting.
  pad: string
}

export function RichTextBlock({ section, pad }: BlockProps<LandingRichTextSection>) {
  const centered = section.align === 'center'
  return (
    <div className={`${pad} ${SECTION}`}>
      <div className={`max-w-3xl ${centered ? 'mx-auto text-center' : ''}`}>
        {section.title && <h2 className={TITLE}>{section.title}</h2>}
        <div className={`${PROSE} md:text-lg`}>
          {/* react-markdown never renders raw HTML, so editor input stays inert. */}
          <ReactMarkdown>{section.content || ''}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export function FeaturesBlock({ section, pad }: BlockProps<LandingFeaturesSection>) {
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={`${TITLE} ${section.subtitle ? 'mb-2' : ''}`}>{section.title}</h2>}
      {section.subtitle && <p className="text-base md:text-lg opacity-70 mb-8">{section.subtitle}</p>}
      <div className={`grid grid-cols-1 ${GRID_COLUMNS[section.columns] || GRID_COLUMNS[3]} gap-6`}>
        {section.items.map((item, index) => (
          <div key={index} className="bg-white text-gray-900 rounded-xl p-6 nice-shadow">
            {item.icon && <div className="text-3xl mb-3" aria-hidden="true">{item.icon}</div>}
            <h3 className="text-lg font-semibold">{item.title}</h3>
            <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatsBlock({ section, pad }: BlockProps<LandingStatsSection>) {
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={`${TITLE} text-center`}>{section.title}</h2>}
      <dl className="flex flex-wrap justify-center gap-x-16 gap-y-8">
        {section.items.map((item, index) => (
          <div key={index} className="flex flex-col items-center text-center min-w-[120px]">
            <dd className="text-4xl md:text-5xl font-bold tracking-tight">{item.value}</dd>
            <dt className="text-sm md:text-base opacity-70 mt-1">{item.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function TestimonialsBlock({ section, pad }: BlockProps<LandingTestimonialsSection>) {
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={TITLE}>{section.title}</h2>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {section.items.map((item, index) => (
          <figure key={index} className="bg-white text-gray-900 rounded-xl p-6 nice-shadow flex flex-col">
            <blockquote className="text-base text-gray-700 leading-relaxed whitespace-pre-line flex-1">
              “{item.quote}”
            </blockquote>
            <figcaption className="flex items-center gap-3 mt-5">
              {item.image_url ? (
                <img src={item.image_url} alt={item.author} className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
                  {(item.author || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-sm font-semibold">{item.author}</div>
                {item.role && <div className="text-xs text-gray-500">{item.role}</div>}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

export function FaqBlock({ section, pad }: BlockProps<LandingFaqSection>) {
  return (
    <div className={`${pad} ${SECTION}`}>
      <div className="max-w-3xl mx-auto">
        {section.title && <h2 className={`${TITLE} text-center`}>{section.title}</h2>}
        <div className="space-y-3">
          {section.items.map((item, index) => (
            // Native <details>: keyboard accessible and works before hydration.
            <details key={index} className="group bg-white text-gray-900 rounded-xl nice-shadow">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none p-5 font-semibold [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span>
                <ChevronDown className="w-5 h-5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-5 text-gray-600 whitespace-pre-line">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CtaBlock({ section, pad }: BlockProps<LandingCtaSection>) {
  return (
    <div className={`${pad} ${SECTION}`}>
      <div
        className="rounded-2xl px-6 py-14 md:px-12 text-center nice-shadow"
        style={{ background: backgroundCss(section.background) || '#0f172a', color: section.textColor || '#ffffff' }}
      >
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight">{section.heading}</h2>
        {section.text && <p className="text-base md:text-lg opacity-80 mt-3 max-w-2xl mx-auto whitespace-pre-line">{section.text}</p>}
        {section.buttons.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mt-8">
            {section.buttons.map((button, index) => (
              <a
                key={index}
                href={safeHref(button.link)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-extrabold shadow-sm transition-transform hover:scale-105"
                style={{ backgroundColor: button.background, color: button.color }}
              >
                {button.text}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function GalleryBlock({ section, pad }: BlockProps<LandingGallerySection>) {
  const images = section.images.filter((image) => image.url)
  if (images.length === 0) return null
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={TITLE}>{section.title}</h2>}
      <div className={`grid grid-cols-2 ${GRID_COLUMNS[section.columns] || GRID_COLUMNS[3]} gap-4`}>
        {images.map((image, index) => (
          <img
            key={index}
            src={image.url}
            alt={image.alt}
            loading="lazy"
            className="w-full aspect-4/3 object-cover rounded-xl nice-shadow"
          />
        ))}
      </div>
    </div>
  )
}

const SPACER_HEIGHTS = { small: 'h-8', medium: 'h-16', large: 'h-32' } as const

export function SpacerBlock({ section }: { section: LandingSpacerSection }) {
  return (
    <div className={`${SECTION} ${SPACER_HEIGHTS[section.size] || SPACER_HEIGHTS.medium} flex items-center`} aria-hidden="true">
      {section.divider && <hr className="w-full border-t border-current opacity-15" />}
    </div>
  )
}


function LandingButtons({ buttons, className = '' }: { buttons: { text: string; link: string; color: string; background: string }[]; className?: string }) {
  if (!buttons?.length) return null
  return (
    <div className={`flex flex-col sm:flex-row gap-3 items-center ${className}`}>
      {buttons.map((button, index) => (
        <a
          key={index}
          href={safeHref(button.link)}
          className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-extrabold shadow-sm transition-transform hover:scale-105 text-center"
          style={{ backgroundColor: button.background, color: button.color }}
        >
          {button.text}
        </a>
      ))}
    </div>
  )
}

export function PricingBlock({
  section,
  pad,
  offers,
  formatPrice,
  labels,
}: BlockProps<LandingPricingSection> & {
  // Public store offers; undefined while loading. Only read by linked plans.
  offers: LandingOffer[] | undefined
  formatPrice: (amount: number, currency: string) => string
  labels: { from: string; subscription: string }
}) {
  const plans = section.plans
    .map((plan) => resolvePricingPlan(plan, offers, formatPrice))
    .filter((plan): plan is NonNullable<typeof plan> => plan !== null)
  if (plans.length === 0) return null
  const columns = plans.length >= 4 ? GRID_COLUMNS[4] : plans.length === 2 ? GRID_COLUMNS[2] : GRID_COLUMNS[3]
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={`${TITLE} text-center ${section.subtitle ? 'mb-2' : ''}`}>{section.title}</h2>}
      {section.subtitle && <p className="text-base md:text-lg opacity-70 mb-10 text-center">{section.subtitle}</p>}
      <div className={`grid grid-cols-1 ${columns} gap-6 items-stretch`}>
        {plans.map((plan, index) => (
          <div
            key={index}
            className={`bg-white text-gray-900 rounded-2xl p-7 flex flex-col nice-shadow ${plan.highlighted ? 'ring-2 ring-gray-900 md:scale-[1.03]' : ''}`}
          >
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <div className="mt-3 flex items-baseline gap-1 flex-wrap">
              {plan.priceIsMinimum && <span className="text-sm text-gray-500">{labels.from}</span>}
              {plan.loading ? (
                <span className="h-10 w-28 rounded-md bg-gray-100 animate-pulse" aria-hidden="true" />
              ) : (
                <span className="text-4xl font-bold tracking-tight">{plan.price}</span>
              )}
              {(plan.period || plan.subscription) && (
                <span className="text-sm text-gray-500">{plan.period || labels.subscription}</span>
              )}
            </div>
            {plan.description && <p className="text-sm text-gray-600 mt-2">{plan.description}</p>}
            <ul className="mt-6 space-y-2 flex-1">
              {plan.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            {plan.button?.text && (
              <a
                href={safeHref(plan.button.link)}
                className="mt-7 px-6 py-2.5 rounded-lg text-sm font-extrabold text-center shadow-sm transition-transform hover:scale-105"
                style={{ backgroundColor: plan.button.background, color: plan.button.color }}
              >
                {plan.button.text}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function StepsBlock({ section, pad }: BlockProps<LandingStepsSection>) {
  const vertical = section.layout === 'vertical'
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={TITLE}>{section.title}</h2>}
      <ol className={vertical ? 'max-w-2xl space-y-8' : `grid grid-cols-1 ${GRID_COLUMNS[section.items.length >= 4 ? 4 : 3]} gap-8`}>
        {section.items.map((item, index) => (
          <li key={index} className={vertical ? 'flex gap-5' : ''}>
            <div className="w-10 h-10 shrink-0 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">{index + 1}</div>
            <div className={vertical ? '' : 'mt-4'}>
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="text-sm opacity-70 mt-1 whitespace-pre-line">{item.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ColumnsBlock({ section, pad }: BlockProps<LandingColumnsSection>) {
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={TITLE}>{section.title}</h2>}
      <div className={`grid grid-cols-1 ${GRID_COLUMNS[section.items.length >= 4 ? 4 : section.items.length === 2 ? 2 : 3]} gap-10`}>
        {section.items.map((item, index) => (
          <div key={index} className={PROSE}>
            <ReactMarkdown>{item.content || ''}</ReactMarkdown>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ImageBlock({ section, pad }: BlockProps<LandingImageSection>) {
  if (!section.image?.url) return null
  const image = (
    <img
      src={section.image.url}
      alt={section.image.alt}
      loading="lazy"
      className={`w-full h-auto ${section.rounded ? 'rounded-2xl nice-shadow' : ''}`}
    />
  )
  return (
    <figure className={`${pad} ${SECTION}`}>
      {section.link ? <a href={safeHref(section.link)}>{image}</a> : image}
      {section.caption && <figcaption className="text-sm opacity-60 text-center mt-3">{section.caption}</figcaption>}
    </figure>
  )
}

export function EmbedBlock({ section, pad }: BlockProps<LandingEmbedSection>) {
  const src = resolveLandingEmbed(section.url)
  if (!src) return null
  const height = Math.min(1600, Math.max(200, Number(section.height) || 600))
  return (
    <div className={`${pad} ${SECTION}`}>
      {section.title && <h2 className={TITLE}>{section.title}</h2>}
      <iframe
        src={src}
        title={section.title || 'Embedded content'}
        loading="lazy"
        className="w-full rounded-xl nice-shadow bg-white"
        style={{ height }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
        allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture"
      />
    </div>
  )
}

export function BannerBlock({ section }: { section: LandingBannerSection }) {
  return (
    <div className={`${SECTION} mt-3`}>
      <div
        className="rounded-lg px-4 py-2.5 text-sm font-medium flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center"
        style={{ background: section.background || '#0f172a', color: section.textColor || '#ffffff' }}
      >
        <span>{section.text}</span>
        {section.linkText && (
          <a href={safeHref(section.link)} className="underline underline-offset-2 font-semibold">
            {section.linkText}
          </a>
        )}
      </div>
    </div>
  )
}

export function CountdownBlock({ section, pad, labels }: BlockProps<LandingCountdownSection> & { labels: [string, string, string, string] }) {
  // Null until mounted: the server and the first client render must agree, and
  // neither knows the visitor's clock.
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    const tick = () => setNow(new Date())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])
  const parts = now ? countdownParts(section.target, now) : null
  const cells = parts ? [parts.days, parts.hours, parts.minutes, parts.seconds] : [0, 0, 0, 0]

  return (
    <div className={`${pad} ${SECTION} text-center`}>
      {section.heading && <h2 className={`${TITLE} mb-2`}>{section.heading}</h2>}
      {section.text && <p className="text-base md:text-lg opacity-70 whitespace-pre-line">{section.text}</p>}
      {parts?.done && section.doneText ? (
        <p className="text-2xl font-bold mt-8">{section.doneText}</p>
      ) : (
        <div className="flex justify-center gap-3 sm:gap-5 mt-8" aria-live="off">
          {cells.map((value, index) => (
            <div key={index} className="bg-white text-gray-900 rounded-xl nice-shadow w-20 sm:w-24 py-4">
              <div className="text-3xl sm:text-4xl font-bold tabular-nums">{parts ? String(value).padStart(2, '0') : '--'}</div>
              <div className="text-xs text-gray-500 mt-1">{labels[index]}</div>
            </div>
          ))}
        </div>
      )}
      <LandingButtons buttons={section.buttons} className="justify-center mt-8" />
    </div>
  )
}

/** Plays a one-off entrance animation when the section first scrolls into view. */
export function Reveal({ animation, children }: { animation: 'fade' | 'slide-up'; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const id = setTimeout(() => setShown(true), 0)
      return () => clearTimeout(id)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className={`w-full flex flex-col items-center transition-all duration-700 ease-out ${
        shown ? 'opacity-100 translate-y-0' : `opacity-0 ${animation === 'slide-up' ? 'translate-y-8' : ''}`
      }`}
    >
      {children}
    </div>
  )
}
