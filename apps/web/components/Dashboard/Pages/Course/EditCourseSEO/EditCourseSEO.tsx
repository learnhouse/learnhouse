'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useCourseFieldSync } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { ResourceSeoPanel, cleanSeoForSave } from '@components/Dashboard/Shared/SEO/ResourceSeoPanel'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { parseLearnings, type ResourceSeo } from '@/lib/seo/meta'
import { EditorPage, EditorSkeleton } from '../courseEditorUi'

type EditCourseSEOProps = {
  orgslug: string
  course_uuid?: string
}

/**
 * Course editor → SEO tab. SEO settings ride the course editor's own save
 * (pending changes + header Save, validated by the API); the URL slug saves
 * on its own with an explicit button.
 */
function EditCourseSEO(props: EditCourseSEOProps) {
  const { syncChanges, courseStructure, isLoading, pendingChanges, unsyncedChanges } = useCourseFieldSync('editCourseSEO')
  const session = useLHSession() as any
  const org = useOrg() as any
  const token = session?.data?.tokens?.access_token

  const [seo, setSeo] = useState<ResourceSeo>({})
  const [slug, setSlug] = useState<string | null>(null)
  const initialised = useRef(false)

  useEffect(() => {
    if (!courseStructure || initialised.current) return
    initialised.current = true
    setSeo(courseStructure.seo || {})
    setSlug(courseStructure.slug || null)
  }, [courseStructure])

  // Saved SEO changed on the server (Atlas applied an SEO change, or another
  // tab saved): show it, unless there are SEO edits here not saved yet.
  const serverSeo = JSON.stringify(courseStructure?.seo || {})
  const hasLocalSeoEdit = 'seo' in (pendingChanges || {}) || 'seo' in (unsyncedChanges || {})
  const [lastServerSeo, setLastServerSeo] = useState(serverSeo)
  if (serverSeo !== lastServerSeo) {
    setLastServerSeo(serverSeo)
    if (!hasLocalSeoEdit) {
      setSeo(courseStructure?.seo || {})
      setSlug(courseStructure?.slug || null)
    }
  }

  if (isLoading || !courseStructure) {
    return (
      <EditorPage>
        <EditorSkeleton sections={3} />
      </EditorPage>
    )
  }

  const onChange = (next: ResourceSeo) => {
    setSeo(next)
    syncChanges({ seo: cleanSeoForSave(next) })
  }

  const thumbnailUrl = courseStructure.thumbnail_image
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, courseStructure.course_uuid, courseStructure.thumbnail_image)
    : null

  return (
    <EditorPage width="wide">
      <ResourceSeoPanel
        type="course"
        uuid={courseStructure.course_uuid}
        orgslug={props.orgslug}
        token={token}
        name={courseStructure.name || ''}
        description={courseStructure.description}
        body={courseStructure.about}
        thumbnailUrl={thumbnailUrl}
        slug={slug}
        learnings={parseLearnings(courseStructure.learnings).length}
        chapters={(courseStructure.chapters || []).length}
        isPublic={!!courseStructure.public && !!courseStructure.published}
        value={seo}
        onChange={onChange}
        onSlugSaved={setSlug}
      />
    </EditorPage>
  )
}

export default EditCourseSEO
