'use client';
import { use } from "react";
import '@styles/globals.css'
import { SessionProvider } from 'next-auth/react'
import Watermark from '@components/Objects/Watermark'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu'

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
        <OrgMenu orgslug={params?.orgslug}></OrgMenu>
        {children}
        <Watermark />
      </SessionProvider>
    </>
  )
}
