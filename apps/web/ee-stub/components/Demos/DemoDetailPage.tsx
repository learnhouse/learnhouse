import { notFound } from 'next/navigation'

// Demo instances are an Enterprise Edition feature: this page does not exist
// in open-source builds.
export default function DemoInstancesUnavailable(_props: { demoUuid: string }): never {
  notFound()
}
