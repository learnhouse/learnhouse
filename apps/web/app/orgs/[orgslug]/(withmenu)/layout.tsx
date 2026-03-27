'use client';
import { use } from "react";
import '@styles/globals.css'
import { SessionProvider } from '@components/Contexts/AuthContext'
import Watermark from '@components/Objects/Watermark'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu'
import { useOrg } from '@components/Contexts/OrgContext'
import { OrgJoinBanner, OrgJoinBannerProvider } from '@components/Objects/Banners/OrgJoinBanner'
import { PodcastPlayerProvider } from '@components/Contexts/PodcastPlayerContext'
import dynamic from 'next/dynamic'
const PodcastPlayer = dynamic(() => import('@components/Objects/Podcasts/PodcastPlayer'), { ssr: false })
import Image from 'next/image'
import Link from 'next/link'
import { PageViewTracker } from '@components/Analytics/PageViewTracker'
import { usePathname } from 'next/navigation'
import { isOSSMode } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'
import { getGoogleFontUrl, DEFAULT_FONT } from '@/lib/fonts'

// Helper to convert hex to rgba
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
  const plan = usePlan()
  const watermarkConfig = org?.config?.config?.customization?.general?.watermark ?? org?.config?.config?.general?.watermark
  const isFree = plan === 'free'
  const showWatermark = isOSSMode() || isFree || watermarkConfig !== false

  return (
    <footer className="w-full py-8 mt-12">
      <div className="flex flex-col items-center justify-center space-y-4">
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

function LayoutContent({ children, orgslug }: { children: React.ReactNode; orgslug: string }) {
  const org = useOrg() as any
  const primaryColor = org?.config?.config?.customization?.general?.color || org?.config?.config?.general?.color || ''
  const customFont = org?.config?.config?.customization?.general?.font || org?.config?.config?.general?.font || ''
  const pathname = usePathname()

  const pathParts = pathname?.split('/').filter(Boolean) || []

  // Pages that use a full-bleed layout (no footer/watermark)
  const noFooterPaths = ['copilot']
  const isFullBleedPage = noFooterPaths.some((p) => pathParts.includes(p))

  return (
    <>
      {customFont && customFont !== DEFAULT_FONT && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href={getGoogleFontUrl(customFont)} rel="stylesheet" />
        </>
      )}
      <div
        className="flex flex-col min-h-screen"
        style={{
          backgroundColor: primaryColor ? hexToRgba(primaryColor, 0.05) : 'transparent',
          ...(customFont ? { fontFamily: `'${customFont}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` } : {}),
        }}
      >
      <PageViewTracker />
      <OrgJoinBanner />
      <OrgMenu orgslug={orgslug} />
      <div className="flex-1 relative" style={{ zIndex: 'var(--z-content)' }}>
        {children}
      </div>
      {!isFullBleedPage && <OrgFooter />}
      {!isFullBleedPage && <Watermark />}
    </div>
    </>
  )
}

export default function RootLayout(
  props: {
    children: React.ReactNode
    params: Promise<any>
  }
) {
  const params = use(props.params);

  const {
    children
  } = props;

  return (
    <>
      <SessionProvider>
        <OrgJoinBannerProvider>
          <PodcastPlayerProvider>
            <LayoutContent orgslug={params?.orgslug}>
              {children}
            </LayoutContent>
            <PodcastPlayer />
          </PodcastPlayerProvider>
        </OrgJoinBannerProvider>
      </SessionProvider>
    </>
  )
}
