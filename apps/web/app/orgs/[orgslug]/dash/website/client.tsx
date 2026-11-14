'use client'
import dynamic from 'next/dynamic'
import { EditorSkeleton } from '@components/Dashboard/Pages/Course/courseEditorUi'

// The gallery renders live page previews: its own chunk, loaded on this page only.
const WebsiteHome = dynamic(() => import('@components/Dashboard/Pages/Website/WebsiteHome'), {
  ssr: false,
  loading: () => (
    <div className="px-4 sm:px-10 pt-8">
      <EditorSkeleton sections={2} rows={3} />
    </div>
  ),
})

export default function WebsiteClient() {
  return <WebsiteHome />
}
