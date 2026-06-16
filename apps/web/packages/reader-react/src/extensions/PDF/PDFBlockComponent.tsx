'use client'

import { NodeViewWrapper } from '@tiptap/react'
import { useResolvedBlockMediaUrl } from '../_shared'

export default function PDFBlockComponent(props: any) {
  const blockObject = props.node.attrs.blockObject
  const url = useResolvedBlockMediaUrl({
    blockObject,
    activityUuidFallback: props.extension.options.activity?.activity_uuid,
    type: 'pdfBlock',
  })

  if (!blockObject || !url) return null

  return (
    <NodeViewWrapper className="block-pdf w-full">
      <div className="w-full rounded-lg overflow-hidden bg-gray-100" style={{ aspectRatio: '4/5' }}>
        <iframe
          src={url}
          title="PDF"
          className="w-full h-full"
          allow="fullscreen"
        />
      </div>
    </NodeViewWrapper>
  )
}
