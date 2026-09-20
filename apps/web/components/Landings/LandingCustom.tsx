'use client'

import React from 'react'
import { LandingPageSettings, LandingSection } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getOrgCourses } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import CourseThumbnailLanding from '@components/Objects/Thumbnails/CourseThumbnailLanding'
import UserAvatar from '@components/Objects/UserAvatar'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getPublicOffers } from '@services/payments/offers'
import { formatCurrency } from '@/lib/format'
import { backgroundCss, deviceClass, hasSectionFrame, isSectionVisible, resolveLandingVideo, sanitizeAnchor, spacingClass } from './landingSections'
import { BannerBlock, ColumnsBlock, CountdownBlock, CtaBlock, EmbedBlock, FaqBlock, FeaturesBlock, GalleryBlock, ImageBlock, PricingBlock, Reveal, RichTextBlock, SpacerBlock, StatsBlock, StepsBlock, TestimonialsBlock } from './LandingBlocks'

interface LandingCustomProps {
  landing: {
    sections: LandingSection[]
    enabled: boolean
    settings?: LandingPageSettings
  }
  orgslug: string
}

const HERO_HEIGHTS = {
  small: 'min-h-[260px] sm:min-h-[320px]',
  medium: 'min-h-[400px] sm:min-h-[500px]',
  large: 'min-h-[520px] sm:min-h-[680px]',
  screen: 'min-h-[calc(100vh-120px)]',
} as const

const PAGE_GAPS = { none: '', small: 'gap-4', medium: 'gap-10' } as const

/** One malformed section (a hand-edited import, say) must not blank the whole page. */
class SectionBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function LandingCustom({ landing, orgslug }: LandingCustomProps) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  // Fetch all courses for the organization
  const { data: allCourses } = useQuery({
    queryKey: queryKeys.courses.list(orgslug),
    queryFn: () => getOrgCourses(orgslug, null, access_token),
    enabled: !!orgslug,
    staleTime: 60_000,
  })

  // Pricing plans can link to store offers. Fetch the public listing once, and
  // only when some plan actually links to one.
  const org = useOrg() as any
  const hasLinkedPlans = landing.sections.some(
    (section) => section.type === 'pricing' && section.plans?.some((plan) => plan.offer_uuid)
  )
  const { data: publicOffers } = useQuery({
    queryKey: ['landing-public-offers', org?.id],
    queryFn: async () => {
      // Payments off, or the request failed: resolve to "no offers" so linked
      // plans drop out instead of showing a loading price forever.
      try {
        const result = await getPublicOffers(org.id)
        return result?.success && Array.isArray(result.data) ? result.data : []
      } catch {
        return []
      }
    },
    enabled: hasLinkedPlans && !!org?.id,
    staleTime: 60_000,
  })

  const renderSection = (section: LandingSection) => {
    // 'medium' is the historical py-16, so sections without a style are unchanged.
    const pad = spacingClass(section.style)
    switch (section.type) {
      case 'hero':
        return (
          <div 
            key={`hero-${section.title}`}
            className={`${HERO_HEIGHTS[section.height || 'medium'] || HERO_HEIGHTS.medium} relative overflow-hidden mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full flex items-center justify-center rounded-xl border border-gray-100`}
            style={{
              background: section.background.type === 'solid' 
                ? section.background.color 
                : section.background.type === 'gradient'
                ? `linear-gradient(${section.background.direction || '45deg'}, ${section.background.colors?.join(', ')})`
                : `url(${section.background.image}) center/cover`
            }}
          >
            {!!section.overlay && (
              <div className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: Math.min(80, section.overlay) / 100 }} />
            )}
            <div className={`relative w-full h-full flex flex-col sm:flex-row ${
              section.illustration?.position === 'right' ? 'sm:flex-row-reverse' : 'sm:flex-row'
            } items-stretch`}>
              {/* Logo */}
              {section.illustration?.image.url && (
                <div className={`flex items-${section.illustration.verticalAlign} p-6 w-full ${
                  section.illustration.size === 'small' ? 'sm:w-1/4' :
                  section.illustration.size === 'medium' ? 'sm:w-1/3' :
                  'sm:w-2/5'
                }`}>
                  <img
                    src={section.illustration.image.url}
                    alt={section.illustration.image.alt}
                    className="w-full object-contain"
                  />
                </div>
              )}

              {/* Content */}
              <div className={`flex-1 flex items-center ${
                section.contentAlign === 'left' ? 'justify-start text-start' :
                section.contentAlign === 'right' ? 'justify-end text-end' :
                'justify-center text-center'
              } p-6`}>
                <div className="max-w-2xl">
                  <h1 
                    className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 sm:mb-4"
                    style={{ color: section.heading.color }}
                  >
                    {section.heading.text}
                  </h1>
                  <h2
                    className="text-sm sm:text-base md:text-lg mb-4 sm:mb-6 md:mb-8 font-medium"
                    style={{ color: section.subheading.color }}
                  >
                    {section.subheading.text}
                  </h2>
                  <div className={`flex flex-col sm:flex-row gap-3 sm:gap-4 ${
                    section.contentAlign === 'left' ? 'justify-start' :
                    section.contentAlign === 'right' ? 'justify-end' :
                    'justify-center'
                  } items-center`}>
                    {section.buttons.map((button, index) => (
                      <a
                        key={index}
                        href={button.link}
                        className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-extrabold shadow-sm transition-transform hover:scale-105"
                        style={{
                          backgroundColor: button.background,
                          color: button.color
                        }}
                      >
                        {button.text}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      case 'text-and-image':
        return (
          <div 
            key={`text-image-${section.title}`}
            className={`${pad} mx-2 sm:mx-4 lg:mx-16 w-full`}
          >
            <div className={`flex flex-col md:flex-row items-center gap-8 md:gap-12 bg-white rounded-xl p-6 md:p-8 lg:p-12 nice-shadow ${
              section.flow === 'right' ? 'md:flex-row-reverse' : ''
            }`}>
              <div className="flex-1 w-full max-w-2xl">
                <h2 className="text-2xl md:text-3xl font-bold mb-4 text-gray-900 tracking-tight">{section.title}</h2>
                <div className="prose prose-lg prose-gray max-w-none">
                  <p className="text-base md:text-lg leading-relaxed text-gray-600 whitespace-pre-line">
                    {section.text}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 mt-8">
                  {section.buttons.map((button, index) => (
                    <a
                      key={index}
                      href={button.link}
                      className="px-6 py-3 rounded-xl font-medium shadow-xs transition-all duration-200 hover:scale-105"
                      style={{
                        backgroundColor: button.background,
                        color: button.color
                      }}
                    >
                      {button.text}
                    </a>
                  ))}
                </div>
              </div>
              <div className="flex-1 w-full md:w-auto">
                <div className="relative w-full max-w-[500px] mx-auto px-4 md:px-8">
                  <div className="relative w-full aspect-4/3">
                    <img
                      src={section.image.url}
                      alt={section.image.alt}
                      className="object-contain w-full h-full rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      case 'logos':
        return (
          <div 
            key={`logos-${section.type}`}
            className={`${pad} mx-2 sm:mx-4 lg:mx-16 w-full`}
          >
            {section.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-start mb-16 text-gray-900">{section.title}</h2>
            )}
            <div className="flex justify-center w-full">
              <div className="flex flex-wrap justify-center gap-16 max-w-7xl">
                {section.logos.map((logo, index) => (
                  <div key={index} className="flex items-center justify-center w-[220px] h-[120px]">
                    <img
                      src={logo.url}
                      alt={logo.alt}
                      className="max-h-24 max-w-[200px] object-contain hover:opacity-80 transition-opacity"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      case 'people':
        return (
          <div 
            key={`people-${section.title}`}
            className={`${pad} mx-2 sm:mx-4 lg:mx-16 w-full`}
          >
            <h2 className="text-2xl md:text-3xl font-bold text-start mb-10 text-gray-900">{section.title}</h2>
            <div className="flex flex-wrap justify-center gap-x-20 gap-y-8">
              {section.people.map((person, index) => (
                <div key={index} className="w-[140px] flex flex-col items-center">
                  <div className="w-24 h-24 mb-4">
                    {person.username ? (
                      <UserAvatar
                        username={person.username}
                        width={96}
                        rounded="rounded-full"
                        border="border-4"
                        showProfilePopup
                      />
                    ) : (
                      <img
                        src={person.image_url}
                        alt={person.name}
                        className="w-full h-full rounded-full object-cover border-4 border-white nice-shadow"
                      />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900">{person.name}</h3>
                  <p className="text-sm text-center text-gray-600 mt-1">{person.description}</p>
                </div>
              ))}
            </div>
          </div>
        )
      case 'featured-courses': {
        if (!allCourses) {
          return (
            <div 
              key={`featured-courses-${section.title}`}
              className={`${pad} mx-2 sm:mx-4 lg:mx-16 w-full`}
            >
              <h2 className="text-2xl md:text-3xl font-bold text-start mb-6 text-gray-900">{section.title}</h2>
              <div className="text-center py-6 text-gray-500">{t('courses.loading_courses')}</div>
            </div>
          )
        }

        const featuredCourses = section.mode === 'latest'
          ? [...allCourses]
              .sort((a: any, b: any) => String(b.creation_date || '').localeCompare(String(a.creation_date || '')))
              .slice(0, section.limit || 8)
          : allCourses.filter((course: any) =>
              (section.courses as unknown as string[]).includes(course.course_uuid)
            )

        // Nothing this visitor is allowed to see (private or deleted courses):
        // drop the section rather than render a heading over an empty grid.
        if (featuredCourses.length === 0) return null

        return (
          <div 
            key={`featured-courses-${section.title}`}
            className={`${pad} mx-2 sm:mx-4 lg:mx-16 w-full`}
          >
            <h2 className="text-2xl md:text-3xl font-bold text-start mb-6 text-gray-900">{section.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
              {featuredCourses.map((course: any) => (
                <div key={course.course_uuid} className="w-full flex justify-center">
                  <CourseThumbnailLanding
                    course={course}
                    orgslug={orgslug}
                  />
                </div>
              ))}
            </div>
          </div>
        )
        }
      case 'video': {
        const video = resolveLandingVideo(section.url)
        if (!video) return null

        return (
          <div
            key={`video-${section.title}`}
            className={`${pad} mx-2 sm:mx-4 lg:mx-16 w-full`}
          >
            {section.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-start mb-3 text-gray-900">{section.title}</h2>
            )}
            {section.description && (
              <p className="text-base md:text-lg text-gray-600 mb-6 whitespace-pre-line">{section.description}</p>
            )}
            <div className="w-full max-w-4xl mx-auto aspect-video rounded-xl overflow-hidden nice-shadow bg-black">
              {video.kind === 'embed' ? (
                <iframe
                  src={video.src}
                  title={section.title || 'Video'}
                  className="w-full h-full"
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : (
                <video
                  src={video.src}
                  className="w-full h-full"
                  controls
                  preload="metadata"
                  playsInline
                />
              )}
            </div>
          </div>
        )
      }
      case 'rich-text':
        return <RichTextBlock key="rich-text" section={section} pad={pad} />
      case 'features':
        return <FeaturesBlock key="features" section={section} pad={pad} />
      case 'stats':
        return <StatsBlock key="stats" section={section} pad={pad} />
      case 'testimonials':
        return <TestimonialsBlock key="testimonials" section={section} pad={pad} />
      case 'faq':
        return <FaqBlock key="faq" section={section} pad={pad} />
      case 'cta':
        return <CtaBlock key="cta" section={section} pad={pad} />
      case 'gallery':
        return <GalleryBlock key="gallery" section={section} pad={pad} />
      case 'spacer':
        return <SpacerBlock key="spacer" section={section} />
      case 'pricing':
        return (
          <PricingBlock
            key="pricing"
            section={section}
            pad={pad}
            offers={publicOffers}
            formatPrice={(amount, currency) => formatCurrency(amount, currency, i18n.language)}
            labels={{ from: t('landing.pricing.from'), subscription: t('landing.pricing.subscription') }}
          />
        )
      case 'steps':
        return <StepsBlock key="steps" section={section} pad={pad} />
      case 'columns':
        return <ColumnsBlock key="columns" section={section} pad={pad} />
      case 'image':
        return <ImageBlock key="image" section={section} pad={pad} />
      case 'embed':
        return <EmbedBlock key="embed" section={section} pad={pad} />
      case 'banner':
        return <BannerBlock key="banner" section={section} />
      case 'countdown':
        return (
          <CountdownBlock
            key="countdown"
            section={section}
            pad={pad}
            labels={[t('landing.countdown.days'), t('landing.countdown.hours'), t('landing.countdown.minutes'), t('landing.countdown.seconds')]}
          />
        )
      default:
        return null
    }
  }

  // Background, text color and anchor need an element to live on. Sections
  // without any of them render bare, exactly as before these settings existed.
  const renderFramed = (section: LandingSection, index: number) => {
    let content = renderSection(section)
    if (!content) return null
    const style = section.style
    if (hasSectionFrame(style) && style) {
      const background = backgroundCss(style.background)
      content = (
        <div
          id={sanitizeAnchor(style.anchor)}
          className={[
            'w-full flex flex-col items-center scroll-mt-24',
            background ? 'rounded-xl my-2 px-4 sm:px-8 overflow-hidden' : '',
            style.textColor ? '[&_h2]:text-inherit!' : '',
            style.titleAlign === 'center' ? '[&_h2]:text-center!' : '',
            style.width === 'narrow' ? 'max-w-4xl mx-auto' : '',
          ].join(' ')}
          style={{ background, color: style.textColor || undefined }}
        >
          {content}
        </div>
      )
      if (style.animation === 'fade' || style.animation === 'slide-up') {
        content = <Reveal animation={style.animation}>{content}</Reveal>
      }
    }
    if (section.device === 'desktop' || section.device === 'mobile') {
      content = <div className={`${deviceClass(section.device)} w-full flex-col items-center`}>{content}</div>
    }
    return <SectionBoundary key={index}>{content}</SectionBoundary>
  }

  const settings = landing.settings || {}
  const pageBackground = backgroundCss(settings.background)

  return (
    <div
      className={`flex flex-col items-center justify-between w-full ${settings.width === 'wide' ? 'max-w-[1920px]' : 'max-w-(--breakpoint-2xl)'} mx-auto px-4 sm:px-6 lg:px-16 h-full ${PAGE_GAPS[settings.gap || 'none'] || ''} ${pageBackground ? 'pb-10' : ''}`}
      style={pageBackground ? { background: pageBackground } : undefined}
    >
      {landing.sections
        .filter((section) => isSectionVisible(section, session?.status ?? 'loading'))
        .map((section, index) => renderFramed(section, index))}
    </div>
  )
}

export default LandingCustom