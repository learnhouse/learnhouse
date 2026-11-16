import { notFound } from 'next/navigation'

// OSS stub: required training requires Enterprise Edition.
export default function Page(_props: { params?: Promise<any> }) {
  notFound()
}
