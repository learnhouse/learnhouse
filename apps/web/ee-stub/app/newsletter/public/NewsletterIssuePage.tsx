import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

// OSS stub: newsletters require Enterprise Edition (the public pages 404).
export async function generateMetadata(_props: { params: Promise<any> }): Promise<Metadata> {
  return { robots: { index: false, follow: false } }
}

export default async function Page(_props: { params: Promise<any> }) {
  notFound()
}
