'use client'
import BackofficeShell from '@ee/components/Backoffice/Shell/BackofficeShell'
import BackofficeAuthorization from '@ee/components/Backoffice/Security/BackofficeAuthorization'
import React from 'react'

export default function BackofficeDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <BackofficeAuthorization>
      <BackofficeShell>{children}</BackofficeShell>
    </BackofficeAuthorization>
  )
}
