import { notFound } from 'next/navigation'

// OSS stub: the newsletter requires Enterprise Edition.
export default function Page(_props: { params?: Promise<any> }) {
  notFound()
}
