'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'

interface OrgItem {
  id: number
  name: string
  slug: string
}

interface PaginatedResponse {
  items: OrgItem[]
  total: number
}

export default function OrgPicker({
  value,
  onChange,
}: {
  value: number | ''
  onChange: (orgId: number | '') => void
}) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: queryKeys.superadmin.orgs(),
    queryFn: () =>
      apiFetch(`${getAPIUrl()}ee/superadmin/organizations?page=1&limit=100`, accessToken),
    enabled: !!accessToken,
    staleTime: 30_000,
  })

  const items = data?.items ?? []

  return (
    <select
      value={value === '' ? '' : String(value)}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === '' ? '' : Number(v))
      }}
      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
    >
      <option value="">
        {isLoading ? 'Loading…' : items.length === 0 ? 'No organizations yet' : 'Select an organization'}
      </option>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} (id: {o.id}, slug: {o.slug})
        </option>
      ))}
    </select>
  )
}
