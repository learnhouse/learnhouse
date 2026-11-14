'use client'
import React, { use, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'
import { EditorSkeleton } from '@components/Dashboard/Pages/Course/courseEditorUi'

const loading = () => <EditorSkeleton sections={1} />

// One chunk per tab. The header, tabs and community data are in the parent
// layout, so a tab switch only swaps this body.
const CommunityDiscussions = dynamic(() => import('@components/Dashboard/Pages/Community/CommunityDiscussions'), { loading })
const CommunitySettings = dynamic(() => import('@components/Dashboard/Pages/Community/CommunitySettings'), { loading })
const CommunitySeoTab = dynamic(() => import('@components/Dashboard/Shared/SEO/ResourceSeoTabs').then((m) => m.CommunitySeoTab), { loading })

// The settings used to be five tabs; their URLs now open the matching
// section of the single Settings tab.
const LEGACY_SETTINGS_TABS = ['general', 'thumbnail', 'access', 'course', 'moderation']

export type CommunityParams = {
  subpage: string
  orgslug: string
  communityuuid: string
}

function CommunitySettingsPage(props: { params: Promise<CommunityParams> }) {
  const params = use(props.params)
  const router = useRouter()
  const legacy = LEGACY_SETTINGS_TABS.includes(params.subpage)
  const unknown = !legacy && params.subpage !== 'discussions' && params.subpage !== 'settings' && params.subpage !== 'seo'

  useEffect(() => {
    const base = getUriWithOrg(params.orgslug, '') + `/dash/communities/${params.communityuuid}`
    if (legacy) router.replace(`${base}/settings#${params.subpage}`)
    else if (unknown) router.replace(`${base}/discussions`)
  }, [legacy, unknown, params.orgslug, params.communityuuid, params.subpage, router])

  return (
    <div className="px-4 sm:px-10 pt-6 sm:pt-8 pb-16 space-y-5">
      {params.subpage === 'discussions' && <CommunityDiscussions orgslug={params.orgslug} />}
      {params.subpage === 'settings' && <CommunitySettings />}
      {params.subpage === 'seo' && <CommunitySeoTab orgslug={params.orgslug} />}
      {(legacy || unknown) && <EditorSkeleton sections={1} />}
    </div>
  )
}

export default CommunitySettingsPage
