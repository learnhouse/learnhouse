'use client'
import { getUriWithoutOrg } from '@services/config/config'
import { AlertTriangle, HomeIcon, RefreshCcw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

function ErrorUI(params: { message?: string; submessage?: string }) {
  const router = useRouter()

  function reloadPage() {
    router.refresh()
    window.location.reload()
  }

  return (
    <div className="mx-auto flex flex-col items-center space-y-6 bg-linear-to-b from-rose-100 to-rose-100/5 py-10 antialiased">
      <div className="flex flex-row items-center space-x-5 rounded-xl">
        <AlertTriangle className="text-rose-700" size={45} />
        <div className="flex flex-col">
          <p className="text-3xl font-bold text-rose-700">
            {params.message ? params.message : 'Something went wrong'}
          </p>
          <p className="text-lg font-bold text-rose-700">
            {params.submessage ? params.submessage : ''}
          </p>
        </div>
      </div>
      <div className="flex space-x-4">
        <button
          onClick={() => reloadPage()}
          className="flex items-center space-x-2 rounded-full bg-rose-700 px-4 py-1 text-rose-200 shadow-lg transition-all ease-linear hover:bg-rose-800"
        >
          <RefreshCcw className="text-rose-200" size={17} />
          <span className="text-md font-bold">Retry</span>
        </button>
        <Link
          href={getUriWithoutOrg('/home')}
          className="flex items-center space-x-2 rounded-full bg-gray-700 px-4 py-1 text-gray-200 shadow-lg transition-all ease-linear hover:bg-gray-800"
        >
          <HomeIcon className="text-gray-200" size={17} />
          <span className="text-md font-bold">Home</span>
        </Link>
      </div>
    </div>
  )
}

export default ErrorUI
