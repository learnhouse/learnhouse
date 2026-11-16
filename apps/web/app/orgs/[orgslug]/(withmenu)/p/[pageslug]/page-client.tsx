'use client'
import React from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { FileX } from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'

const BuilderLanding = dynamic(() => import('@components/LandingPages/public/BuilderLanding'))

function NotFound() {
  const { t } = useTranslation()
  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <FileX size={32} className="text-neutral-300" />
        <h1 className="text-xl font-semibold text-neutral-700">{t('landingBuilder.public.not_found_title')}</h1>
        <p className="text-sm text-neutral-500">{t('landingBuilder.public.not_found_text')}</p>
      </div>
    </GeneralWrapperStyled>
  )
}

export default function ExtraPageClient({ orgslug, pageslug }: { orgslug: string; pageslug: string }) {
  const preview = useSearchParams()?.get('landing_preview') || null
  return <BuilderLanding orgslug={orgslug} slug={pageslug} preview={preview} fallback={<NotFound />} />
}
