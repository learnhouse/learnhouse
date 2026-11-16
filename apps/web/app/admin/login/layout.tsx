import type { Metadata } from 'next'
import type React from 'react'

export const metadata: Metadata = {
  title: 'Login',
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
