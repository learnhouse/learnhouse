import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

// OSS stub: the store requires Enterprise Edition.
export async function generateMetadata(_props: { params: Promise<any> }): Promise<Metadata> {
  return {}
}

export default async function Page(_props: { params: Promise<any> }) {
  notFound()
}
