'use client'
import { getUriWithoutOrg } from '@services/config/config'
import { AlertTriangle, HomeIcon, RefreshCcw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

function ErrorUI(params: { message?: string, submessage?: string }) {
  const router = useRouter()

  function reloadPage() {
    router.refresh()
    window.location.reload()
  }

  return (
    <div className="flex flex-col py-10 mx-auto antialiased items-center space-y-6 bg-linear-to-b from-rose-100 to-rose-100/5 ">
      <div className="flex flex-row  items-center space-x-5  rounded-xl ">
        <AlertTriangle className="text-rose-700" size={45} />
        <div className='flex flex-col'>
          <p className="text-3xl font-bold text-rose-700">{params.message ? params.message : 'Something went wrong'}</p>
          <p className="text-lg font-bold text-rose-700">{params.submessage ? params.submessage : ''}</p>
        </div>
      </div>
      <div className='flex space-x-4'>
        <button
          onClick={() => reloadPage()}
          className="flex space-x-2 items-center rounded-full px-4 py-1 text-rose-200 bg-rose-700 hover:bg-rose-800 transition-all ease-linear shadow-lg "
        >
          <RefreshCcw className="text-rose-200" size={17} />
          <span className="text-md font-bold">Retry</span>
        </button>
        <Link
          href={getUriWithoutOrg('/home')}
          className="flex space-x-2 items-center rounded-full px-4 py-1 text-gray-200 bg-gray-700 hover:bg-gray-800 transition-all ease-linear shadow-lg "
        >
          <HomeIcon className="text-gray-200" size={17} />
          <span className="text-md font-bold">Home</span>
        </Link>
      </div>
    </div>
  )
}

export default ErrorUI
