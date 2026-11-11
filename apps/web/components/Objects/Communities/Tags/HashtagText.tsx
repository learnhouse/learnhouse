'use client'
import React from 'react'
import CommunityTagChip from './CommunityTagChip'
import { splitHashtags, useTaggableCommunities } from './communityTags'

// Plain text (comments) with "#community-name" turned into community chips.
export default function HashtagText({ text }: { text: string }) {
  const communities = useTaggableCommunities()
  const parts = splitHashtags(text, communities)
  return (
    <>
      {parts.map((part, i) =>
        'community' in part ? (
          <CommunityTagChip key={i} communityUuid={part.community.community_uuid} name={part.community.name} />
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        )
      )}
    </>
  )
}
