import EmbedActivityClient from './EmbedActivityClient'
import { parseEmbedOptions } from '@/lib/embed/protocol'

type PageProps = {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function EmbedActivityPage({ params, searchParams }: PageProps) {
  const { orgslug, courseuuid, activityid } = await params
  const sp = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  // Only the background is needed here, to paint it before hydration.
  const { bgcolor } = parseEmbedOptions({ get: (name) => first(sp[name]) }, [])

  return (
    <>
      {bgcolor && <style>{`html,body{background-color:${bgcolor}!important}`}</style>}
      <EmbedActivityClient
        activityId={activityid}
        courseuuid={courseuuid}
        orgslug={orgslug}
      />
    </>
  )
}
