import { notFound } from 'next/navigation'

// LTI is an Enterprise feature; without EE its pages do not exist.
export default function LTIPage() {
  notFound()
}
