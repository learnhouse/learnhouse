'use client';
import { use } from "react";
import '@styles/globals.css'
import { SessionProvider } from 'next-auth/react'
import Watermark from '@components/Objects/Watermark'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu'
import { useOrg } from '@components/Contexts/OrgContext'
import { OrgJoinBanner, OrgJoinBannerProvider } from '@components/Objects/Banners/OrgJoinBanner'
import Image from 'next/image'
import Link from 'next/link'

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
  const footerText = org?.config?.config?.general?.footer_text || ''
  const plan = org?.config?.config?.cloud?.plan || 'free'
  const isEnterprise = plan === 'enterprise'

  return (
    <footer className="w-full py-8 mt-12">
      <div className="flex flex-col items-center justify-center space-y-4">
        {footerText && <p className="text-sm text-gray-500">{footerText}</p>}
        {!isEnterprise && (
          <Link href="https://learnhouse.app" target="_blank" rel="noopener noreferrer">
            <Image
              src="/lrn.svg"
              alt="LearnHouse"
              width={24}
              height={24}
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
  const primaryColor = org?.config?.config?.general?.color || ''

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{
        backgroundColor: primaryColor ? hexToRgba(primaryColor, 0.05) : 'transparent'
      }}
    >
      <OrgJoinBanner />
      <OrgMenu orgslug={orgslug}></OrgMenu>
      <div className="flex-1 relative" style={{ zIndex: 'var(--z-content)' }}>
        {children}
      </div>
      <OrgFooter />
      <Watermark />
    </div>
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
          <LayoutContent orgslug={params?.orgslug}>
            {children}
          </LayoutContent>
        </OrgJoinBannerProvider>
      </SessionProvider>
    </>
  )
}
