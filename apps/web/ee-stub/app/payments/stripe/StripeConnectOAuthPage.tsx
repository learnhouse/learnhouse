import { notFound } from 'next/navigation'

// OSS stub: payments require Enterprise Edition.
export default function Page(_props: { params?: Promise<any> }) {
  notFound()
}
