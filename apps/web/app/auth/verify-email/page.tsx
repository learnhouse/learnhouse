import React from 'react'
import VerifyEmailClient from './verify-email'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'LearnHouse - Verify Email',
}

function VerifyEmailPage() {
  return (
    <>
      <VerifyEmailClient />
    </>
  )
}

export default VerifyEmailPage
