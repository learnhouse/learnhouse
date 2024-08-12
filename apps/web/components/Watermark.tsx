import Image from 'next/image'
import Link from 'next/link'
import blacklogo from '@public/black_logo.png'
import React, { useEffect } from 'react'
import { useOrg } from './Contexts/OrgContext'

function Watermark() {
    const org = useOrg() as any

    useEffect(() => {
    }
        , [org]);

    if (org?.config?.config?.general?.watermark) {
        return (
            <div className='fixed bottom-8 right-8'>
                <Link href={`https://www.learnhouse.app/?source=in-app`} className="flex items-center cursor-pointer bg-white/80 backdrop-blur-lg text-gray-700 rounded-2xl p-2 light-shadow text-xs px-5 font-semibold space-x-2">
                    <p>Made with</p>
                    <Image unoptimized src={blacklogo} alt="logo" quality={100} width={85} />
                </Link>
            </div>
        )
    }
    return null
}

export default Watermark