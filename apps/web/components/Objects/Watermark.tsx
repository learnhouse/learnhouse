import Image from 'next/image'
import Link from 'next/link'
import lrnTextLogo from '@public/lrn-text.svg'
import React, { useEffect } from 'react'
import { useOrg } from '../Contexts/OrgContext'
import { useTranslation } from 'react-i18next'
import { isOSSMode } from '@services/config/config'

function Watermark() {
    const { t } = useTranslation()
    const org = useOrg() as any

    useEffect(() => {
    }
        , [org]);

    const plan = org?.config?.config?.cloud?.plan || 'free'
    const isFreeUser = plan === 'free'
    const showWatermark = isOSSMode() || isFreeUser

    if (showWatermark) {
        return (
            <div className='fixed bottom-8 right-8 z-50'>
                <Link href={`https://www.learnhouse.app/?source=in-app`} className="flex items-center cursor-pointer bg-white/80 backdrop-blur-lg text-gray-700 rounded-2xl p-2 light-shadow text-xs px-5 font-semibold space-x-2">
                    <p>{t('common.made_with')}</p>
                    <Image unoptimized src={lrnTextLogo} alt="logo" quality={100} width={95} />
                </Link>
            </div>
        )
    }
    return null
}

export default Watermark