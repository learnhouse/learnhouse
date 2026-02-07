'use client'
import { Building2, ArrowRight } from 'lucide-react'
import React, { useState } from 'react'
import { getLEARNHOUSE_DOMAIN_VAL } from '@services/config/config'
import { stripPort } from '@services/utils/ts/hostUtils'

function OrgNotFound() {
  const [orgSlug, setOrgSlug] = useState('')
  const [isNavigating, setIsNavigating] = useState(false)

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgSlug.trim()) return

    setIsNavigating(true)
    const domain = getLEARNHOUSE_DOMAIN_VAL()
    const baseDomain = stripPort(domain)
    const cleanSlug = orgSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    const protocol = window.location.protocol + '//'
    const port = window.location.port
    const portSuffix = port && port !== '80' && port !== '443' ? `:${port}` : ''

    window.location.href = `${protocol}${cleanSlug}.${baseDomain}${portSuffix}/login`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-md w-full mx-4 p-8 bg-white rounded-2xl shadow-lg">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
            <Building2 className="h-8 w-8 text-gray-600" />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            Enter Your Organization
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            Enter your organization name to continue to the login page.
          </p>
        </div>

        <form onSubmit={handleNavigate} className="mt-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-3 border border-gray-200 focus-within:border-gray-400 focus-within:ring-1 focus-within:ring-gray-400">
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder="your-organization"
                className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-400"
                autoFocus
              />
              <span className="text-gray-400 text-sm">.{stripPort(getLEARNHOUSE_DOMAIN_VAL())}</span>
            </div>

            <button
              type="submit"
              disabled={!orgSlug.trim() || isNavigating}
              className="w-full flex items-center justify-center gap-2 bg-black text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isNavigating ? (
                'Redirecting...'
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Don't know your organization name? Contact your administrator.
        </p>
      </div>
    </div>
  )
}

export default OrgNotFound
