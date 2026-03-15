'use client'

import React, { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertTriangle } from 'lucide-react'

function TokenExchangeInner() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleExchange = async () => {
      const code = searchParams.get('code')
      const redirect = searchParams.get('redirect') || '/dashboard'

      if (!code) {
        setError('Missing authentication code')
        return
      }

      try {
        // Call our own API which server-side exchanges the code for tokens
        const res = await fetch('/api/auth/token-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          credentials: 'include',
        })

        if (!res.ok) {
          setError('Authentication failed. Please try logging in again.')
          return
        }

        // Full page reload so AuthContext initializes fresh with the new cookies
        window.location.href = redirect
      } catch {
        setError('Something went wrong. Please try again.')
      }
    }

    handleExchange()
  }, [searchParams])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-red-100 rounded-full">
              <AlertTriangle className="w-10 h-10 text-red-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Authentication Failed</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <a
            href="/auth/login"
            className="inline-block px-6 py-2.5 bg-black text-white rounded-lg hover:bg-black/90 transition-colors text-sm font-semibold"
          >
            Go to Login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Loader2 className="w-10 h-10 text-gray-600 animate-spin" />
        </div>
        <h1 className="text-lg font-semibold text-gray-800 mb-1">Signing you in...</h1>
        <p className="text-gray-500 text-sm">Please wait while we set up your session.</p>
      </div>
    </div>
  )
}

export default function TokenExchangePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="w-10 h-10 text-gray-600 animate-spin" />
        </div>
      }
    >
      <TokenExchangeInner />
    </Suspense>
  )
}
