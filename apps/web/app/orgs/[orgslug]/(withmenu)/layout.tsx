'use client';
import { use } from "react";
import '@styles/globals.css'
import { SessionProvider } from 'next-auth/react'
import Watermark from '@components/Objects/Watermark'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu'
import { useOrg } from '@components/Contexts/OrgContext'

// Helper to convert hex to rgba
const hexToRgba = (hex: string, alpha: number): string => {
  if (!hex || hex.length < 7) return 'transparent'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function LayoutContent({ children, orgslug }: { children: React.ReactNode; orgslug: string }) {
  const org = useOrg() as any
  const primaryColor = org?.config?.config?.general?.color || ''

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: primaryColor ? hexToRgba(primaryColor, 0.05) : 'transparent'
      }}
    >
      <OrgMenu orgslug={orgslug}></OrgMenu>
      {children}
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
        <LayoutContent orgslug={params?.orgslug}>
          {children}
        </LayoutContent>
      </SessionProvider>
    </>
  )
}
