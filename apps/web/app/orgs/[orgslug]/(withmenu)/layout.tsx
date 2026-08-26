'use client';
import { use, useEffect, type ReactNode } from "react";
import '@styles/globals.css'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu'
import { useOrg } from '@components/Contexts/OrgContext'
import { OrgJoinBanner, OrgJoinBannerProvider } from '@components/Objects/Banners/OrgJoinBanner'
import { OrgMFAPolicyGate } from '@components/Objects/Banners/OrgMFAPolicyGate'
import { PodcastPlayerProvider } from '@components/Contexts/PodcastPlayerContext'
import AppliedLearningGate from '@components/Acyberschool/AppliedLearningGate'
import AcyberLearningAssistant from '@components/Acyberschool/AcyberLearningAssistant'
import AcyberMobileDock from '@components/Acyberschool/AcyberMobileDock'
import dynamic from 'next/dynamic'
const PodcastPlayer = dynamic(() => import('@components/Objects/Podcasts/PodcastPlayer'), { ssr: false })
import Link from 'next/link'
import { PageViewTracker } from '@components/Analytics/PageViewTracker'
import { usePathname, useSearchParams } from 'next/navigation'
import { getGoogleFontUrl, DEFAULT_FONT } from '@/lib/fonts'

const hexToRgba = (hex: string, alpha: number): string => {
  if (!hex || hex.length < 7) return 'transparent'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function OrgFooter() {
  const org = useOrg() as any
  const footerText = org?.config?.config?.customization?.general?.footer_text || org?.config?.config?.general?.footer_text || ''

  return (
    <footer className="mb-20 w-full border-t border-black/[0.05] bg-white py-8 md:mb-0">
      <div className="flex flex-col items-center justify-center gap-2 px-4 text-center">
        {footerText && <p className="text-sm text-gray-500">{footerText}</p>}
        <Link href="https://www.acyberschool.com" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-black/40 hover:text-black/65">
          Acyberschool
        </Link>
      </div>
    </footer>
  )
}

function LayoutContent({ children, orgslug }: { children: ReactNode; orgslug: string }) {
  const org = useOrg() as any
  const primaryColor = org?.config?.config?.customization?.general?.color || org?.config?.config?.general?.color || ''
  const customFont = org?.config?.config?.customization?.general?.font || org?.config?.config?.general?.font || ''
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const chromeless = searchParams?.get('chrome') === 'none'

  useEffect(() => {
    if (!customFont || customFont === DEFAULT_FONT) return

    const fontId = `gfont-${customFont.replace(/\s/g, '-')}`
    if (document.getElementById(fontId)) return

    const preconnect1 = document.createElement('link')
    preconnect1.rel = 'preconnect'
    preconnect1.href = 'https://fonts.googleapis.com'
    document.head.appendChild(preconnect1)

    const preconnect2 = document.createElement('link')
    preconnect2.rel = 'preconnect'
    preconnect2.href = 'https://fonts.gstatic.com'
    preconnect2.crossOrigin = 'anonymous'
    document.head.appendChild(preconnect2)

    const link = document.createElement('link')
    link.id = fontId
    link.rel = 'stylesheet'
    link.href = getGoogleFontUrl(customFont)
    document.head.appendChild(link)

    return () => {
      document.head.removeChild(preconnect1)
      document.head.removeChild(preconnect2)
      const existing = document.getElementById(fontId)
      if (existing) document.head.removeChild(existing)
    }
  }, [customFont])

  const pathParts = pathname?.split('/').filter(Boolean) || []
  const noFooterPaths = ['copilot']
  const isFullBleedPage = noFooterPaths.some((p) => pathParts.includes(p))

  return (
    <div
      className="lh-org-font-root flex min-h-screen flex-col"
      style={{
        backgroundColor: primaryColor ? hexToRgba(primaryColor, 0.05) : 'transparent',
        ...(customFont ? { fontFamily: `'${customFont}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` } : {}),
      }}
    >
      <PageViewTracker />
      {!chromeless && <OrgJoinBanner />}
      {!chromeless && <OrgMenu orgslug={orgslug} />}
      {!chromeless && <OrgMFAPolicyGate />}
      {!chromeless && <AppliedLearningGate />}
      {!chromeless && <AcyberLearningAssistant />}
      {!chromeless && <AcyberMobileDock orgslug={orgslug} />}
      <div className="relative flex-1 pb-20 md:pb-0" style={{ zIndex: 'var(--z-content)' }}>
        {children}
      </div>
      {!isFullBleedPage && !chromeless && <OrgFooter />}
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
          <LayoutContent orgslug={params?.orgslug}>
            {children}
          </LayoutContent>
          <PodcastPlayer />
        </PodcastPlayerProvider>
      </OrgJoinBannerProvider>
      </SessionGate>
    </>
  )
}