'use client'
import { useTranslation } from 'react-i18next'

interface NewPodcastButtonProps {
  disabled?: boolean
}

function NewPodcastButton({ disabled = false }: NewPodcastButtonProps) {
  const { t } = useTranslation()
  return (
    <div
      className={`rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'
      }`}
    >
      <div>{t('podcasts.new_podcast')} </div>
      <div className="text-md bg-neutral-800 px-1 rounded-full">+</div>
    </div>
  )
}

export default NewPodcastButton
