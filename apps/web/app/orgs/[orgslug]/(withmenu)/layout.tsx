'use client';
import { use, useEffect, type CSSProperties, type ReactNode } from "react";
import '@styles/globals.css'
import Watermark from '@components/Objects/Watermark'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu'
import { useOrg } from '@components/Contexts/OrgContext'
import { OrgJoinBanner, OrgJoinBannerProvider } from '@components/Objects/Banners/OrgJoinBanner'
import { OrgMFAPolicyGate } from '@components/Objects/Banners/OrgMFAPolicyGate'
import { PodcastPlayerProvider } from '@components/Contexts/PodcastPlayerContext'
import { SiteCommandPaletteProvider } from '@components/Objects/Search/SiteCommandPaletteContext'
import { ShortcutsProvider } from '@/lib/shortcuts/ShortcutsContext'
import { MessagingProvider } from '@components/Messaging/MessagingProvider'
import GlobalShortcuts from '@components/Objects/Shortcuts/GlobalShortcuts'
import dynamic from 'next/dynamic'
import AfterLoad from '@components/Utils/AfterLoad'
const PodcastPlayer = dynamic(() => import('@components/Objects/Podcasts/PodcastPlayer'), { ssr: false })
const SiteCommandPalette = dynamic(() => import('@components/Objects/Search/SiteCommandPalette'), { ssr: false })
const ShortcutHelp = dynamic(() => import('@components/Objects/Shortcuts/ShortcutHelp'), { ssr: false })
const LiveNowBanner = dynamic(() => import('@ee/components/LiveSessions/LiveNowBanner'), { ssr: false })
const CompanySpaceBar = dynamic(() => import('@ee/components/Companies/CompanySpaceBar'), { ssr: false })
// The chat dock brings the whole messaging UI (threads, markdown, code
// highlighting, charts) and only floats over the page, so it loads once the
// page has loaded instead of in, or alongside, its first download, and only
// for signed-in members of an org with messaging (the gate is tiny).
import ChatDockGate from '@components/Messaging/Dock/ChatDockGate'
import Image from 'next/image'
import Link from 'next/link'
import { PageViewTracker } from '@components/Analytics/PageViewTracker'
import { usePathname, useSearchParams } from 'next/navigation'
import { useShowLearnHouseBranding } from '@components/Hooks/useLearnHouseBranding'
import { themeFontsHref, themeRootProps } from '@/lib/theme/orgTheme'
import { useOrgTheme } from '@/lib/theme/useOrgTheme'

function OrgFooter() {
  const org = useOrg() as any
  const footerText = org?.config?.config?.customization?.general?.footer_text || org?.config?.config?.general?.footer_text || ''
  const showWatermark = useShowLearnHouseBranding()

  return (
    <footer className="lh-org-footer w-full py-8 mt-12">
      <div className="flex flex-col items-center justify-center space-y-4">
        {/* Shown by the "centered" footer style only (styles/theme.css). */}
        <span className="lh-org-footer-name lh-t-heading hidden text-lg font-semibold text-gray-800">{org?.name}</span>
        {footerText && <p className="text-sm text-gray-500">{footerText}</p>}
        {showWatermark && (
          <Link href="https://learnhouse.app" target="_blank" rel="noopener noreferrer">
            <Image
              src="/lrn.svg"
              alt="LearnHouse"
              width={24}
              height={24}
              style={{ height: 'auto' }}
              className="opacity-15 hover:opacity-40 transition-opacity duration-300 cursor-pointer"
            />
          </Link>
        )}
      </div>
    </footer>
  )
}

function LayoutContent({ children, orgslug }: { children: ReactNode; orgslug: string }) {
  // The org theme: CSS variables + data attributes on this root, consumed by
  // the marker classes in styles/theme.css (see lib/theme/orgTheme.ts).
  const theme = useOrgTheme()
  const themeRoot = themeRootProps(theme)
  const fontsHref = themeFontsHref(theme)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // chrome=none strips the org navigation/footer so this route can be embedded
  // inside another view (e.g. a Resource activity iframe) without duplicate chrome.
  const chromeless = searchParams?.get('chrome') === 'none'

  // Inject the org's Google Fonts stylesheet (body + heading pair, one
  // request) into document head. Nothing loads for the default face.
  useEffect(() => {
    if (!fontsHref) return

    const fontId = 'lh-theme-fonts'
    if (document.getElementById(fontId)) return

    // Add preconnect hints
    const preconnect1 = document.createElement('link')
    preconnect1.rel = 'preconnect'
    preconnect1.href = 'https://fonts.googleapis.com'
    document.head.appendChild(preconnect1)

    const preconnect2 = document.createElement('link')
    preconnect2.rel = 'preconnect'
    preconnect2.href = 'https://fonts.gstatic.com'
    preconnect2.crossOrigin = 'anonymous'
    document.head.appendChild(preconnect2)

    // Add font stylesheet
    const link = document.createElement('link')
    link.id = fontId
    link.rel = 'stylesheet'
    link.href = fontsHref
    document.head.appendChild(link)

    return () => {
      document.head.removeChild(preconnect1)
      document.head.removeChild(preconnect2)
      const existing = document.getElementById(fontId)
      if (existing) document.head.removeChild(existing)
    }
  }, [fontsHref])

  const pathParts = pathname?.split('/').filter(Boolean) || []

  // Pages that use a full-bleed layout (no footer/watermark)
  const noFooterPaths = ['messages']
  const isFullBleedPage = noFooterPaths.some((p) => pathParts.includes(p))

  return (
    <div
      // lh-org-font-root gives globals.css a hook to override this inline
      // font-family in Arabic, where Tajawal replaces the org's custom face
      // outright. An inline style beats any normal rule, so the override has to
      // target this element specifically.
      className="lh-org-font-root lh-theme flex flex-col min-h-screen"
      {...themeRoot.attrs}
      style={{
        backgroundColor: 'transparent',
        ...(themeRoot.style as CSSProperties),
        // Room for the phone tab bar / activity bar (0 on desktop).
        paddingBottom: 'var(--lh-mobile-nav-h)',
      }}
    >
      <PageViewTracker />
      {!chromeless && <OrgJoinBanner />}
      {!chromeless && <OrgMenu orgslug={orgslug} />}
      {/* A company's part of the academy: its bar, under the menu (EE). */}
      {!chromeless && <CompanySpaceBar orgslug={orgslug} />}
      {/* Org-wide 2FA policy: renders nothing unless this user is non-compliant. */}
      {!chromeless && <OrgMFAPolicyGate />}
      <div className="flex-1 relative" style={{ zIndex: 'var(--z-content)' }}>
        {children}
      </div>
      {!isFullBleedPage && !chromeless && <OrgFooter />}
      {!isFullBleedPage && !chromeless && <Watermark />}
      {!chromeless && <GlobalShortcuts />}
      {/* Overlays that are closed (or absent) on load: their code comes once
          the page has loaded, not in the same burst as the page's own chunks. */}
      {!chromeless && (
        <AfterLoad>
          <SiteCommandPalette />
          <ShortcutHelp />
          <ChatDockGate orgslug={orgslug} />
          <LiveNowBanner orgslug={orgslug} />
        </AfterLoad>
      )}
    </div>
  )
}

export default function RootLayout(
  props: {
    children: ReactNode
    params: Promise<any>
  }
) {
  const params = use(props.params);

  const {
    children
  } = props;

  return (
    <>
      <SessionGate>
      <OrgJoinBannerProvider>
        <PodcastPlayerProvider>
          <SiteCommandPaletteProvider>
            <ShortcutsProvider>
              <MessagingProvider orgslug={params?.orgslug}>
                <LayoutContent orgslug={params?.orgslug}>
                  {children}
                </LayoutContent>
              </MessagingProvider>
            </ShortcutsProvider>
          </SiteCommandPaletteProvider>
          <PodcastPlayer />
        </PodcastPlayerProvider>
      </OrgJoinBannerProvider>
      </SessionGate>
    </>
  )
}
