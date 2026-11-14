import type { Metadata } from 'next'
import DemoDetailPage from '@ee/components/Demos/DemoDetailPage'

export const metadata: Metadata = {
  title: 'Demo',
}

export default async function AdminDemoDetailPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params
  return <DemoDetailPage demoUuid={uuid} />
}
