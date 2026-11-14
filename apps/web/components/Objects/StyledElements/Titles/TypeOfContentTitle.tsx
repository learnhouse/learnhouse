import React from 'react'
import { BookCopy, SquareLibrary, Headphones } from 'lucide-react'
import { CalendarDots, ChalkboardSimple, HouseSimple, Circuitry, Garage, Lightning, VideoCamera } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

interface TypeOfContentTitleProps {
  title: string
  type: 'col' | 'com' | 'cou' | 'tra' | 'pod' | 'board' | 'pg' | 'live' | 'cal' | string
}

function TypeOfContentTitle({ title, type }: TypeOfContentTitleProps) {
  const { t } = useTranslation()

  const getIcon = () => {
    switch (type) {
      case 'col':
        return <SquareLibrary className="w-4 h-4 text-black" />
      case 'com':
        return <Garage size={16} className="text-black" weight="fill" />
      case 'cou':
        return <BookCopy className="w-4 h-4 text-black" />
      case 'tra':
        return <HouseSimple size={16} className="text-black" weight="fill" />
      case 'pod':
        return <Headphones className="w-4 h-4 text-black" />
      case 'path':
        return <Circuitry className="w-4 h-4 text-black" />
      case 'board':
        return <ChalkboardSimple size={16} className="text-black" weight="fill" />
      case 'pg':
        return <Lightning size={16} className="text-black" weight="fill" />
      case 'live':
        return <VideoCamera size={16} className="text-black" weight="fill" />
      case 'cal':
        return <CalendarDots size={16} className="text-black" weight="fill" />
      default:
        return null
    }
  }

  return (
    <div className="flex items-center gap-2.5 my-4 group cursor-default">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white nice-shadow">
        {getIcon()}
      </div>
      <h1 className="text-xl font-bold text-gray-900 tracking-tight">
        {title}
      </h1>
    </div>
  )
}

export default TypeOfContentTitle
