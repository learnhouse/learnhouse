'use client'
import React from 'react'
import {
  Browser,
  Certificate,
  ChatCircleText,
  Compass,
  Icon as PhosphorIcon,
  MagnifyingGlass,
  Play,
  SidebarSimple,
  SignIn,
  SquaresFour,
  Layout,
  Rows,
} from '@phosphor-icons/react'
import { SiFacebook, SiInstagram, SiX, SiYoutube } from '@icons-pack/react-simple-icons'
import { cn } from '@/lib/utils'
import { hexToRgba, isLightHex } from './BrandingShared'

/**
 * Every vignette is a hand-drawn miniature of a real LearnHouse surface,
 * rendered with the admin's actual assets. They are not screenshots and
 * not CSS-scaled components: fixed pixel sizes keep them legible and let
 * a logo sit in the exact box it will occupy for real.
 */

/* ------------------------------------------------------------------------ */
/* Frame                                                                     */
/* ------------------------------------------------------------------------ */

interface VignetteProps {
  icon: PhosphorIcon
  label: string
  children: React.ReactNode
  className?: string
  /** Width class for the framed surface. */
  size?: string
}

export function Vignette({ icon: Icon, label, children, className, size = 'w-[228px]' }: VignetteProps) {
  return (
    <figure className={cn('flex flex-col gap-2 min-w-0', size)}>
      <div className={cn('relative overflow-hidden rounded-xl ring-1 ring-black/[0.07] bg-[#f4f4f5]', className)}>
        {children}
      </div>
      <figcaption className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
        <Icon size={12} weight="bold" className="text-gray-400" />
        {label}
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------------------ */
/* Bits                                                                      */
/* ------------------------------------------------------------------------ */

export interface LogoSources {
  squareUrl?: string | null
  wideUrl?: string | null
  name?: string
}

/** Same fallback chain as OrgSquareLogo, but driven by URLs so local previews win. */
export function LogoInSquare({
  squareUrl,
  wideUrl,
  name,
  className,
  insetClassName = 'p-[12%]',
  fallback,
}: LogoSources & { className?: string; insetClassName?: string; fallback?: React.ReactNode }) {
  return (
    <span className={cn('flex items-center justify-center overflow-hidden bg-white', className)}>
      {squareUrl ? (
        <img src={squareUrl} alt="" className="h-full w-full object-cover" />
      ) : wideUrl ? (
        <img src={wideUrl} alt="" className={cn('h-full w-full object-contain', insetClassName)} />
      ) : (
        fallback ?? (
          <span className="text-[60%] font-bold text-gray-500">
            {(name || '?').trim().charAt(0).toUpperCase()}
          </span>
        )
      )}
    </span>
  )
}

function Line({ w, className }: { w: string; className?: string }) {
  return <span className={cn('block h-1.5 rounded-full bg-gray-200', w, className)} />
}

/* ------------------------------------------------------------------------ */
/* Surfaces                                                                  */
/* ------------------------------------------------------------------------ */

interface PublicHeaderVignetteProps {
  wideUrl?: string | null
  name?: string
  primaryColor?: string
  font?: string
  label: string
  /** Larger variant for the theme tab's live preview. */
  large?: boolean
}

/** The public site header (OrgMenu) plus the first strip of page under it. */
export function PublicHeaderVignette({ wideUrl, name, primaryColor, font, label, large }: PublicHeaderVignetteProps) {
  const tinted = Boolean(primaryColor)
  const light = !tinted || isLightHex(primaryColor!)
  const ink = light ? 'text-gray-800' : 'text-white'
  const pill = light ? 'bg-black/[0.07]' : 'bg-white/20'
  const fontFamily = font ? `'${font}', sans-serif` : undefined
  return (
    <Vignette icon={Layout} label={label} size={large ? 'w-full' : 'w-[300px]'}>
      <div style={{ backgroundColor: tinted ? hexToRgba(primaryColor!, 0.06) : '#f8f8f8', fontFamily }}>
        <div
          className={cn('flex items-center justify-between gap-2', large ? 'h-12 px-4' : 'h-8 px-2.5', !tinted && 'bg-white/90 nice-shadow')}
          style={{ backgroundColor: primaryColor || undefined }}
        >
          <span className={cn('flex items-center', large ? 'h-7' : 'h-5')}>
            {wideUrl ? (
              <img src={wideUrl} alt="" className="h-full w-auto max-w-[110px] object-contain rounded-sm" />
            ) : (
              <span className={cn('font-semibold truncate', ink, large ? 'text-sm' : 'text-[9px]')}>{name || 'LearnHouse'}</span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('rounded-full', pill, large ? 'h-2 w-10' : 'h-1.5 w-6')} />
            <span className={cn('rounded-full', pill, large ? 'h-2 w-8' : 'h-1.5 w-5')} />
            <span className={cn('rounded-full', pill, large ? 'h-2 w-9' : 'h-1.5 w-5')} />
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('flex items-center rounded-md', pill, large ? 'h-6 w-20 px-2' : 'h-4 w-12 px-1')}>
              <MagnifyingGlass size={large ? 10 : 7} className={cn(light ? 'text-gray-500' : 'text-white/80')} />
            </span>
            <span className={cn('rounded-full', pill, large ? 'h-6 w-6' : 'h-4 w-4')} />
          </span>
        </div>
        <div className={cn('flex gap-2', large ? 'p-4' : 'p-2.5')}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn('flex-1 rounded-md bg-white shadow-sm', large ? 'h-16' : 'h-8')} />
          ))}
        </div>
        {large && (
          <div className="px-4 pb-4 flex items-center gap-2">
            <span
              className={cn('rounded-md px-3 py-1.5 text-[11px] font-semibold', tinted ? '' : 'bg-black text-white')}
              style={tinted ? { backgroundColor: primaryColor, color: light ? '#111' : '#fff' } : undefined}
            >
              Sign up
            </span>
            <span className="text-[11px] text-gray-500">Welcome to {name || 'your school'}</span>
          </div>
        )}
      </div>
    </Vignette>
  )
}

interface LoginPanelVignetteProps extends LogoSources {
  label: string
  welcome?: string
  backgroundStyle: React.CSSProperties
  textColor: 'light' | 'dark'
  /** True when the background is a photo, which gets a dark scrim. */
  scrim?: boolean
  showLearnHouseMark?: boolean
  /** Larger variant for the sign-in tab's live preview. */
  large?: boolean
}

/** The right-hand branding panel of the sign-in page (AuthBrandingPanel). */
export function LoginPanelVignette({
  squareUrl,
  wideUrl,
  name,
  welcome,
  backgroundStyle,
  textColor,
  scrim,
  showLearnHouseMark = true,
  label,
  large,
}: LoginPanelVignetteProps) {
  const light = textColor === 'light'
  return (
    <Vignette icon={SignIn} label={label} size={large ? 'w-full' : 'w-[228px]'}>
      <div className={cn('flex bg-white', large ? 'h-[300px]' : 'h-[150px]')}>
        {/* form side */}
        <div className={cn('flex items-center justify-center', large ? 'w-[42%] p-6' : 'w-[38%] p-3')}>
          <div className={cn('w-full space-y-1.5', large ? 'max-w-[150px] space-y-2' : 'max-w-[64px]')}>
            <Line w={large ? 'w-24 h-2.5 bg-gray-800' : 'w-9 bg-gray-700'} />
            <Line w={large ? 'w-32 h-1.5' : 'w-12'} />
            <span className={cn('block rounded border border-gray-200 bg-gray-50', large ? 'h-6 mt-3' : 'h-3 mt-1.5')} />
            <span className={cn('block rounded border border-gray-200 bg-gray-50', large ? 'h-6' : 'h-3')} />
            <span className={cn('block rounded bg-gray-900', large ? 'h-6 mt-3' : 'h-3 mt-1.5')} />
          </div>
        </div>
        {/* branding side */}
        <div className={cn('relative flex-1', large ? 'm-3 rounded-xl' : 'm-1.5 rounded-md', 'overflow-hidden')} style={backgroundStyle}>
          {scrim && <span className="absolute inset-0 bg-black/30" />}
          {showLearnHouseMark && (
            <img
              src="/lrn.svg"
              alt=""
              className={cn('absolute', large ? 'top-3 start-3 h-4' : 'top-1.5 start-1.5 h-2', light ? 'opacity-60 invert' : 'opacity-40')}
            />
          )}
          <div className={cn('relative z-10 flex h-full flex-col items-center justify-center text-center', large ? 'gap-3 px-6' : 'gap-1.5 px-3', light ? 'text-white' : 'text-gray-900')}>
            <LogoInSquare
              squareUrl={squareUrl}
              wideUrl={wideUrl}
              name={name}
              className={cn('ring-1 ring-inset ring-white/10', large ? 'h-16 w-16 rounded-2xl' : 'h-9 w-9 rounded-lg')}
              insetClassName={large ? 'p-2' : 'p-1'}
            />
            <span className={cn('font-black tracking-tight leading-tight', large ? 'text-lg' : 'text-[9px]')}>{name || 'LearnHouse'}</span>
            {welcome && (
              <span className={cn('leading-snug', large ? 'text-xs max-w-[220px]' : 'text-[7px] max-w-[110px] line-clamp-2', light ? 'text-white/70' : 'text-gray-600')}>
                {welcome}
              </span>
            )}
          </div>
        </div>
      </div>
    </Vignette>
  )
}

interface OrgSwitcherVignetteProps extends LogoSources {
  label: string
  description?: string
}

/** The organization card on the hub's "Your organizations" list. */
export function OrgSwitcherVignette({ squareUrl, wideUrl, name, description, label }: OrgSwitcherVignetteProps) {
  return (
    <Vignette icon={SquaresFour} label={label}>
      <div className="p-3 space-y-2 bg-[#f8f8f8]">
        <div className="flex items-center gap-2 rounded-xl bg-white p-2 nice-shadow">
          <LogoInSquare
            squareUrl={squareUrl}
            wideUrl={wideUrl}
            name={name}
            className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-inset ring-black/5"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold text-gray-900 leading-tight">{name || 'Your organization'}</p>
            <p className="mt-0.5 truncate text-[8px] text-gray-400">{description || 'Choose an organization to continue'}</p>
          </div>
          <span className="h-3 w-1.5 rounded-full bg-gray-200" />
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/60 p-2 opacity-60">
          <span className="h-9 w-9 shrink-0 rounded-lg bg-gray-200" />
          <div className="flex-1 space-y-1.5">
            <Line w="w-16" />
            <Line w="w-24 bg-gray-100" />
          </div>
        </div>
      </div>
    </Vignette>
  )
}

interface SidebarVignetteProps extends LogoSources {
  label: string
  plan?: string
}

/** The top of the dashboard's dark left rail (DashLeftMenu). */
export function SidebarVignette({ squareUrl, wideUrl, name, plan, label }: SidebarVignetteProps) {
  return (
    <Vignette icon={SidebarSimple} label={label} size="w-[160px]">
      <div className="flex h-[150px] bg-[#f4f4f5]">
        <div className="w-[118px] bg-[#0f0f10] p-2.5 text-white">
          <div className="flex items-center gap-2">
            <LogoInSquare
              squareUrl={squareUrl}
              wideUrl={wideUrl}
              name={name}
              className="h-7 w-7 shrink-0 rounded-md"
              insetClassName="p-0.5"
            />
            <div className="min-w-0">
              <p className="truncate text-[9px] font-semibold leading-tight">{name || 'Your organization'}</p>
              <span className="mt-0.5 inline-block rounded bg-white/10 px-1 text-[6px] font-bold uppercase tracking-wider text-white/70">
                {plan || 'free'}
              </span>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {['w-14', 'w-10', 'w-12', 'w-9', 'w-11'].map((w, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-white/15" />
                <Line w={w} className="bg-white/15 h-1" />
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 p-2">
          <Line w="w-6 bg-gray-300" />
          <span className="mt-2 block h-14 rounded-md bg-white shadow-sm" />
        </div>
      </div>
    </Vignette>
  )
}

interface BrowserTabVignetteProps {
  faviconUrl?: string | null
  name?: string
  label: string
}

/** A browser tab strip: the favicon is the only thing an admin sees of it. */
export function BrowserTabVignette({ faviconUrl, name, label }: BrowserTabVignetteProps) {
  return (
    <Vignette icon={Browser} label={label} size="w-[260px]">
      <div className="bg-[#dfe1e5]">
        <div className="flex items-end gap-1 px-2 pt-2">
          <div className="flex h-7 w-[150px] items-center gap-1.5 rounded-t-lg bg-white px-2.5">
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-sm">
              {faviconUrl ? (
                <img src={faviconUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="h-full w-full rounded-sm bg-gray-300" />
              )}
            </span>
            <span className="truncate text-[9px] text-gray-700">{name || 'Your organization'}</span>
            <span className="ms-auto text-[9px] text-gray-400">×</span>
          </div>
          <div className="flex h-6 w-[70px] items-center gap-1.5 rounded-t-lg bg-white/40 px-2">
            <span className="h-3 w-3 rounded-sm bg-gray-300/70" />
            <Line w="w-8 bg-gray-300/70 h-1" />
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white px-2 py-1.5">
          <span className="text-[9px] text-gray-300">‹ ›</span>
          <span className="flex h-4 flex-1 items-center rounded-full bg-[#f1f3f4] px-2 text-[8px] text-gray-500">
            {name ? `${name.toLowerCase().replace(/\s+/g, '')}.learnhouse.io` : 'your-school.learnhouse.io'}
          </span>
        </div>
        <div className="h-8 bg-[#f8f8f8]" />
      </div>
    </Vignette>
  )
}

interface CertificateVignetteProps {
  wideUrl?: string | null
  squareUrl?: string | null
  name?: string
  label: string
}

/** The header of a completion certificate. */
export function CertificateVignette({ wideUrl, squareUrl, name, label }: CertificateVignetteProps) {
  return (
    <Vignette icon={Certificate} label={label}>
      <div className="flex h-[130px] flex-col items-center justify-center gap-1.5 bg-[#fffdf7] p-3 text-center">
        <div className="flex items-center gap-2">
          <span className="h-px w-8 bg-amber-700/30" />
          <LogoInSquare
            squareUrl={squareUrl}
            wideUrl={wideUrl}
            name={name}
            className="h-8 w-8 rounded-md bg-transparent"
            insetClassName="p-0"
          />
          <span className="h-px w-8 bg-amber-700/30" />
        </div>
        <p className="text-[7px] uppercase tracking-[0.2em] text-amber-800/70">Certificate of completion</p>
        <Line w="w-20 bg-gray-300 h-1" />
        <Line w="w-28 bg-gray-200 h-1" />
        <p className="mt-1 text-[7px] text-gray-400">{name || 'Your organization'}</p>
      </div>
    </Vignette>
  )
}

interface ExploreCardVignetteProps {
  thumbnailUrl?: string | null
  name?: string
  description?: string
  label: string
}

/** Your organization's card on the LearnHouse explore listing. */
export function ExploreCardVignette({ thumbnailUrl, name, description, label }: ExploreCardVignetteProps) {
  return (
    <Vignette icon={Compass} label={label} size="w-[200px]">
      <div className="bg-[#f8f8f8] p-3">
        <div className="overflow-hidden rounded-lg bg-white nice-shadow">
          <div className="aspect-[2/1] w-full bg-gray-200">
            {thumbnailUrl && <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="p-2">
            <p className="truncate text-[10px] font-semibold text-gray-900">{name || 'Your organization'}</p>
            <p className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-gray-400">
              {description || 'A short description of what you teach.'}
            </p>
          </div>
        </div>
      </div>
    </Vignette>
  )
}

interface LinkPreviewVignetteProps {
  thumbnailUrl?: string | null
  name?: string
  host?: string
  label: string
}

/** The unfurled link card in chat apps and social feeds. */
export function LinkPreviewVignette({ thumbnailUrl, name, host, label }: LinkPreviewVignetteProps) {
  return (
    <Vignette icon={ChatCircleText} label={label} size="w-[228px]">
      <div className="bg-white p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-full bg-gray-200" />
          <Line w="w-12 h-1" />
        </div>
        <div className="ms-5 rounded-md border-s-2 border-gray-300 bg-[#f4f4f5] p-2">
          <p className="truncate text-[8px] text-gray-400">{host || 'learnhouse.io'}</p>
          <p className="truncate text-[9px] font-semibold text-gray-900">{name || 'Your organization'}</p>
          <div className="mt-1.5 aspect-[1.91/1] w-full overflow-hidden rounded bg-gray-200">
            {thumbnailUrl && <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />}
          </div>
        </div>
      </div>
    </Vignette>
  )
}

export interface GalleryItem {
  id: string
  kind: 'image' | 'youtube' | 'loom'
  url: string
}

/** The media strip at the top of the explore listing detail. */
export function GalleryVignette({ items, label }: { items: GalleryItem[]; label: string }) {
  const [first, ...rest] = items
  return (
    <Vignette icon={Rows} label={label} size="w-[260px]">
      <div className="bg-[#f8f8f8] p-3">
        <div className="grid grid-cols-[3fr_1fr] gap-1.5">
          <GalleryCell item={first} tall />
          <div className="grid grid-rows-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <GalleryCell key={rest[i]?.id ?? i} item={rest[i]} />
            ))}
          </div>
        </div>
      </div>
    </Vignette>
  )
}

function GalleryCell({ item, tall }: { item?: GalleryItem; tall?: boolean }) {
  return (
    <span className={cn('relative block overflow-hidden rounded-md bg-gray-200', tall ? 'h-[84px]' : 'h-full min-h-[24px]')}>
      {item && <img src={item.url} alt="" className="h-full w-full object-cover" />}
      {item && item.kind !== 'image' && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
          <Play size={tall ? 14 : 8} weight="fill" />
        </span>
      )}
    </span>
  )
}

interface FooterLinksVignetteProps {
  socials: Record<string, string | undefined>
  links: Record<string, string>
  name?: string
  label: string
}

/** The public footer, where social links and custom links are listed. */
export function FooterLinksVignette({ socials, links, name, label }: FooterLinksVignetteProps) {
  const icons: { key: string; Icon: React.ElementType; color: string }[] = [
    { key: 'twitter', Icon: SiX, color: '#111' },
    { key: 'facebook', Icon: SiFacebook, color: '#1877F2' },
    { key: 'instagram', Icon: SiInstagram, color: '#E4405F' },
    { key: 'youtube', Icon: SiYoutube, color: '#FF0000' },
  ]
  const active = icons.filter((i) => socials[i.key])
  const customLinks = Object.keys(links).filter(Boolean)
  return (
    <Vignette icon={Layout} label={label} size="w-full max-w-[420px]">
      <div className="bg-[#f8f8f8]">
        <div className="space-y-1.5 p-3">
          <span className="block h-10 rounded-md bg-white shadow-sm" />
        </div>
        <div className="border-t border-gray-200/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
            {customLinks.length === 0 && active.length === 0 && (
              <span className="text-[8px] text-gray-400">Links you add will show here</span>
            )}
            {customLinks.map((k) => (
              <span key={k} className="text-[8px] font-medium text-gray-600">
                {k}
              </span>
            ))}
            {active.length > 0 && customLinks.length > 0 && <span className="h-2 w-px bg-gray-300" />}
            {active.map(({ key, Icon, color }) => (
              <Icon key={key} size={9} color={color} />
            ))}
          </div>
          <p className="mt-2 text-center text-[7px] text-gray-400">© {name || 'Your organization'}</p>
        </div>
      </div>
    </Vignette>
  )
}
