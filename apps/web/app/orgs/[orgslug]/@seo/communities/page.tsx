import { ListPageSeo } from '@/lib/seo/listPageSeo'

export default async function Seo({ params }: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await params
  return <ListPageSeo orgslug={orgslug} title="Communities" path="/communities" kind="communities" />
}
