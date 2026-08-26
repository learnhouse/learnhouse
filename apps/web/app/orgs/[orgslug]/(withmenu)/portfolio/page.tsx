import AppliedLearningPortfolio from '@components/Acyberschool/AppliedLearningPortfolio'

export default async function PortfolioPage({ params }: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await params
  return <AppliedLearningPortfolio orgslug={orgslug} />
}
