// OSS stub: boards require Enterprise Edition (their routes 404).
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export async function generateMetadata(_props: unknown): Promise<Metadata> {
  return { robots: { index: false, follow: false } }
}

export default function BoardsDashPage(_props: { params?: Promise<any> }): never {
  notFound()
}
