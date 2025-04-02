import type { Metadata } from 'next'
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
