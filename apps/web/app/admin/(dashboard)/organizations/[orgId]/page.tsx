'use client'
import { useParams } from 'next/navigation'
import OrgDetailPage from '@components/Admin/OrgDetail/OrgDetailPage'

export default function AdminOrgDetailPage() {
  const params = useParams()
  return <OrgDetailPage orgId={String(params.orgId)} />
}
