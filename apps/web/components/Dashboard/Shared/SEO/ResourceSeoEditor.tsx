'use client'
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { StickySaveBar } from '@components/Dashboard/Shared/DashKit/DashKit'
import { EditorSkeleton, ErrorNotice } from '@components/Dashboard/Pages/Course/courseEditorUi'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getSeoSettings, updateSeoSettings } from '@services/seo/seo'
import { revalidateTags } from '@services/utils/ts/requests'
import { useSeoT } from '@/lib/seo/i18n'
import type { ResourceSeo } from '@/lib/seo/meta'
import type { SeoResourceType } from '@/lib/seo/paths'
import { ResourceSeoPanel, cleanSeoForSave } from './ResourceSeoPanel'

/**
 * SEO tab for a path, podcast, community or folder: loads the resource's SEO
 * settings, edits them in the shared panel and saves with the sticky bar.
 */
export function ResourceSeoEditor({
  type,
  uuid,
  orgslug,
  thumbnailUrl,
  body,
  isPublic,
  onSaved,
}: {
  type: SeoResourceType
  uuid: string
  orgslug: string
  thumbnailUrl?: string | null
  body?: string | null
  isPublic?: boolean
  /** Lets the editor refresh its own copy of the resource (e.g. new slug). */
  onSaved?: () => void
}) {
  const st = useSeoT()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['seo', type, uuid], [type, uuid])
  const { data, error, isLoading } = useQuery({
    queryKey,
    queryFn: () => getSeoSettings(type, uuid, token),
    enabled: !!token,
    staleTime: 30_000,
  })
  const [draft, setDraft] = useState<ResourceSeo | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) setDraft(data.seo || {})
  }, [data])

  const dirty = !!data && !!draft && JSON.stringify(cleanSeoForSave(draft)) !== JSON.stringify(cleanSeoForSave(data.seo || {}))

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await updateSeoSettings(type, uuid, { seo: cleanSeoForSave(draft) }, token)
      queryClient.setQueryData(queryKey, res)
      toast.success(st('saved'))
      revalidateTags(['seo-sitemap'], orgslug)
      onSaved?.()
    } catch (e: any) {
      toast.error(typeof e?.message === 'string' && e.message ? e.message : st('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  if (error) return <ErrorNotice>{st('save_failed')}</ErrorNotice>
  if (isLoading || !data || !draft) return <EditorSkeleton sections={2} />

  return (
    <>
      <ResourceSeoPanel
        type={type}
        uuid={data.uuid}
        orgslug={orgslug}
        token={token}
        name={data.name}
        description={data.description}
        body={body}
        thumbnailUrl={thumbnailUrl}
        slug={data.slug}
        isPublic={isPublic}
        value={draft}
        onChange={setDraft}
        onSlugSaved={(slug) => {
          queryClient.setQueryData(queryKey, { ...data, slug })
          onSaved?.()
        }}
      />
      <StickySaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(data.seo || {})} />
    </>
  )
}
