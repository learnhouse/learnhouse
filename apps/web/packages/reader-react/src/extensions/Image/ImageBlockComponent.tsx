'use client'

import { NodeViewWrapper } from '@tiptap/react'
import { useResolvedBlockMediaUrl } from '../_shared'

const UNSPLASH_UTM = '?utm_source=LearnHouse&utm_medium=referral'
const withUtm = (url?: string | null) => (url ? `${url}${UNSPLASH_UTM}` : '')

export default function ImageBlockComponent(props: any) {
  const blockObject = props.node.attrs.blockObject
  const size = props.node.attrs.size ?? { width: 300 }
  const alignment = props.node.attrs.alignment ?? 'center'

  const unsplashUrl: string | null = props.node.attrs.unsplash_url ?? null
  const unsplashPhotographerName: string | null =
    props.node.attrs.unsplash_photographer_name ?? null
  const unsplashPhotographerUrl: string | null =
    props.node.attrs.unsplash_photographer_url ?? null
  const unsplashPhotoUrl: string | null = props.node.attrs.unsplash_photo_url ?? null

  const resolvedUrl = useResolvedBlockMediaUrl({
    blockObject,
    activityUuidFallback: props.extension.options.activity?.activity_uuid,
    type: 'imageBlock',
  })

  const imageUrl = unsplashUrl ?? resolvedUrl
  if (!imageUrl) return null

  const itemsAlignment =
    alignment === 'left'
      ? 'items-start'
      : alignment === 'right'
        ? 'items-end'
        : 'items-center'

  const frameStyle = { width: size.width, maxWidth: '100%' as const }

  const unsplashCredit =
    unsplashUrl && unsplashPhotographerName ? (
      <p className="mt-2 text-[11px] text-neutral-500">
        Photo by{' '}
        <a
          href={withUtm(unsplashPhotographerUrl) || withUtm(unsplashPhotoUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-neutral-700"
        >
          {unsplashPhotographerName}
        </a>{' '}
        on{' '}
        <a
          href={`https://unsplash.com/${UNSPLASH_UTM}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-neutral-700"
        >
          Unsplash
        </a>
      </p>
    ) : null

  return (
    <NodeViewWrapper className="block-image w-full">
      <div className={`w-full flex flex-col ${itemsAlignment}`}>
        <div style={frameStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="rounded-lg max-w-full h-auto w-full" />
        </div>
        {unsplashCredit && <div style={frameStyle}>{unsplashCredit}</div>}
      </div>
    </NodeViewWrapper>
  )
}
