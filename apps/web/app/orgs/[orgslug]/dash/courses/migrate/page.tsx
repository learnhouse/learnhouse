import MigrationClient from './client'

export default async function MigrationPage({
  params,
}: {
  params: Promise<{ orgslug: string }>
}) {
  const { orgslug } = await params
  return <MigrationClient orgslug={orgslug} />
}
