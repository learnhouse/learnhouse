import { redirect } from 'next/navigation'

type PageParams = Promise<{ orgslug: string; playgrounduuid: string }>

// Friendly alias: /play/<uuid> → /playground/<uuid> (the route keeps its old name).
export default async function PlayAliasPage({ params }: { params: PageParams }) {
  const { playgrounduuid } = await params
  redirect(`/playground/${encodeURIComponent(playgrounduuid)}`)
}
