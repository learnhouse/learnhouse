'use client'
import { useCookies } from '@components/Contexts/CookiesContext'
import { getUriWithoutOrg } from '@services/config/config'
import { Diamond, Home, PersonStanding } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

function InfoUI(params: { message?: string, submessage?: string, cta?: string, href: string }) {
    const cookies = useCookies() as any;
    return (
        <div className="flex flex-col py-10 mx-auto antialiased items-center space-y-6 bg-gradient-to-b from-yellow-100 to-yellow-100/5 ">
            <div className="flex flex-row  items-center space-x-5  rounded-xl ">
                <Diamond className="text-yellow-700" size={45} />
                <div className='flex flex-col'>
                    <p className="text-3xl font-bold text-yellow-700">{params.message ? params.message : 'Something went wrong'}</p>
                    <p className="text-lg font-bold text-yellow-700">{params.submessage ? params.submessage : ''}</p>
                </div>
            </div>
            {params.cta && <div className='flex space-x-4'>
                <Link
                    href={params.href}
                    className="flex space-x-2 items-center rounded-full px-4 py-1 text-yellow-200 bg-yellow-700 hover:bg-yellow-800 transition-all ease-linear shadow-lg "
                >
                    <PersonStanding className="text-yellow-200" size={17} />
                    <span className="text-md font-bold">{params.cta}</span>
                </Link>
                <Link
                    href={getUriWithoutOrg('/home', cookies)}
                    className="flex space-x-2 items-center rounded-full px-4 py-1 text-gray-200 bg-gray-700 hover:bg-gray-800 transition-all ease-linear shadow-lg "
                >
                    <Home className="text-gray-200" size={17} />
                    <span className="text-md font-bold">Home</span>
                </Link>
            </div>}
        </div>
    )
}

export default InfoUI
