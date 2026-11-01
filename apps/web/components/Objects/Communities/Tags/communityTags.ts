import { useQuery } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getCommunities } from '@services/communities/communities'
import { asArray } from '@services/utils/ts/requests'

export interface TaggableCommunity {
  community_uuid: string
  name: string
  description?: string
}

// The only shape a tag may point at. Lesson content is author-written JSON,
// so a tag's uuid is checked before it goes into any API path.
const COMMUNITY_UUID = /^community_[A-Za-z0-9-]{1,64}$/

export function isCommunityUuid(value: unknown): value is string {
  return typeof value === 'string' && COMMUNITY_UUID.test(value)
}

// How a community is written in plain text: "Product Questions" -> "product-questions".
export function communitySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// "#name" in plain text, not inside a word or a URL fragment ("a#b", "/#x").
export const HASHTAG_PATTERN = /(^|[\s(])#([a-z0-9][a-z0-9_-]{0,63})/gi

export type HashtagPart = { text: string } | { community: TaggableCommunity; raw: string }

// Splits plain text into text and the hashtags that name a known community.
// Unknown hashtags stay text.
export function splitHashtags(text: string, communities: TaggableCommunity[]): HashtagPart[] {
  const bySlug = new Map(communities.map((c) => [communitySlug(c.name), c]))
  const parts: HashtagPart[] = []
  let last = 0
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const community = bySlug.get(match[2].toLowerCase())
    if (!community) continue
    const start = (match.index ?? 0) + match[1].length
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ community, raw: `#${match[2]}` })
    last = start + match[2].length + 1
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

export function filterCommunities(query: string, communities: TaggableCommunity[]): TaggableCommunity[] {
  const q = communitySlug(query)
  return communities
    .filter((c) => !q || communitySlug(c.name).includes(q))
    .slice(0, 8)
}

// The org's communities the viewer can see (public ones for visitors), for
// "#" autocomplete and to recognise hashtags in plain text.
export function useTaggableCommunities() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const { data } = useQuery({
    queryKey: ['communities', org?.id, 'tags'],
    queryFn: () => getCommunities(org.id, 1, 50, {}, accessToken),
    enabled: !!org?.id,
    staleTime: 60_000,
  })
  return asArray<TaggableCommunity>(data)
}
