import React from 'react'
import ForgotPasswordClient from './forgot'
import { Metadata } from 'next'

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