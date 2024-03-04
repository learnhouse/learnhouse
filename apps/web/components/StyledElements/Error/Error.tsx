'use client'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React from 'react'

function ErrorUI() {
  const router = useRouter()

  function reloadPage() {
    router.refresh()
    window.location.reload()
  }

  return (
    <div className="flex flex-col py-10 mx-auto antialiased items-center space-y-6 bg-gradient-to-b from-rose-100 to-rose-100/5 ">
      <div className="flex flex-row  items-center space-x-5  rounded-xl ">
        <AlertTriangle className="text-rose-700" size={45} />
        <p className="text-3xl font-bold text-rose-700">Something went wrong</p>
      </div>
      <div>
        <button
          onClick={() => reloadPage()}
          className="flex space-x-2 items-center rounded-full px-4 py-1 text-rose-200 bg-rose-700 hover:bg-rose-800 transition-all ease-linear shadow-lg "
        >
          <RefreshCcw className="text-rose-200" size={17} />
          <span className="text-md font-bold">Retry</span>
        </button>
      </div>
    </div>
  )
}

export default ErrorUI
