import { redirect } from 'next/navigation'

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ orgslug: string; communityuuid: string }>
}) {
  const { communityuuid } = await params
  // Browser-relative path only — the proxy adds the /orgs/{slug} prefix; a
  // slug-prefixed path would be double-prefixed → 404.
  redirect(`/dash/communities/${communityuuid}/general`)
}
