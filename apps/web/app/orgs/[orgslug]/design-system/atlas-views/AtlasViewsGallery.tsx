'use client'
import dynamic from 'next/dynamic'

// Client-only: the gallery is interactive and reads the browser locale.
const ViewGallery = dynamic(() => import('@ee/components/Atlas/blocks/views/ViewGallery'), { ssr: false })

export default function AtlasViewsGallery() {
  return <ViewGallery />
}
