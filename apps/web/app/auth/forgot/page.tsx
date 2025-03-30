import type { Metadata } from 'next'
import React from 'react'
import ForgotPasswordClient from './forgot'

export const metadata: Metadata = {
  title: 'LearnHouse - Forgot Password',
}

function ForgotPasswordPage() {
  return (
    <>
      <ForgotPasswordClient />
    </>
  )
}

export default ForgotPasswordPage
