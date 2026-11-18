'use client'
import { useParams } from 'next/navigation'
import OrgDetailPage from '@ee/components/Backoffice/OrgDetail/OrgDetailPage'

export default function BackofficeOrgDetailPage() {
  const params = useParams()
  return <OrgDetailPage orgId={String(params.orgId)} />
}
