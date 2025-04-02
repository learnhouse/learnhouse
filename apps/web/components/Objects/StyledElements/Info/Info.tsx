'use client'
import { getUriWithoutOrg } from '@services/config/config'
import { Diamond, Home, PersonStanding } from 'lucide-react'
import Link from 'next/link'

function InfoUI(params: {
  message?: string
  submessage?: string
  cta?: string
  href: string
}) {
  return (
    <div className="mx-auto flex flex-col items-center space-y-6 bg-linear-to-b from-yellow-100 to-yellow-100/5 py-10 antialiased">
      <div className="flex flex-row items-center space-x-5 rounded-xl">
        <Diamond className="text-yellow-700" size={45} />
        <div className="flex flex-col">
          <p className="text-3xl font-bold text-yellow-700">
            {params.message ? params.message : 'Something went wrong'}
          </p>
          <p className="text-lg font-bold text-yellow-700">
            {params.submessage ? params.submessage : ''}
          </p>
        </div>
      </div>
      {params.cta && (
        <div className="flex space-x-4">
          <Link
            href={params.href}
            className="flex items-center space-x-2 rounded-full bg-yellow-700 px-4 py-1 text-yellow-200 shadow-lg transition-all ease-linear hover:bg-yellow-800"
          >
            <PersonStanding className="text-yellow-200" size={17} />
            <span className="text-md font-bold">{params.cta}</span>
          </Link>
          <Link
            href={getUriWithoutOrg('/home')}
            className="flex items-center space-x-2 rounded-full bg-gray-700 px-4 py-1 text-gray-200 shadow-lg transition-all ease-linear hover:bg-gray-800"
          >
            <Home className="text-gray-200" size={17} />
            <span className="text-md font-bold">Home</span>
          </Link>
        </div>
      )}
    </div>
  )
}

export default InfoUI
