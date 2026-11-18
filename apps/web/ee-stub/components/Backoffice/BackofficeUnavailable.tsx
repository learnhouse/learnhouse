import { notFound } from 'next/navigation'

// LearnHouse Backoffice (the platform console) is an Enterprise Edition
// feature: none of its pages exist in open-source builds.
export default function BackofficeUnavailable(_props: Record<string, unknown>): never {
  notFound()
}
