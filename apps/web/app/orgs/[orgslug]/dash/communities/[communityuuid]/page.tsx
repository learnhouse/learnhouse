import { redirect } from 'next/navigation'

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ orgslug: string; communityuuid: string }>
}) {
  const { orgslug, communityuuid } = await params
  redirect(`/${orgslug}/dash/communities/${communityuuid}/general`)
}
