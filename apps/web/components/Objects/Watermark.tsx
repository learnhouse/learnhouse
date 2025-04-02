import blacklogo from '@public/black_logo.png'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { useOrg } from '../Contexts/OrgContext'

function Watermark() {
  const org = useOrg() as any

  useEffect(() => {}, [org])

  if (org?.config?.config?.general?.watermark) {
    return (
      <div className="fixed right-8 bottom-8">
        <Link
          href={`https://www.learnhouse.app/?source=in-app`}
          className="light-shadow flex cursor-pointer items-center space-x-2 rounded-2xl bg-white/80 p-2 px-5 text-xs font-semibold text-gray-700 backdrop-blur-lg"
        >
          <p>Made with</p>
          <Image
            unoptimized
            src={blacklogo}
            alt="logo"
            quality={100}
            width={85}
          />
        </Link>
      </div>
    )
  }
  return null
}

export default Watermark
