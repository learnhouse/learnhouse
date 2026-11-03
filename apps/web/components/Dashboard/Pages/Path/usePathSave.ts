'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { Path } from '@services/paths/paths'
import { useQueryClient } from '@tanstack/react-query'

/** Writes a fresh Path from the API into the cache the editor reads from,
 * and marks the org listing stale so cards pick up the change. */
export function usePathCache() {
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const accessToken = session?.data?.tokens?.access_token as string

  const store = (updated: Path) => {
    queryClient.setQueryData(queryKeys.paths.detail(updated.path_uuid), updated)
    queryClient.invalidateQueries({ queryKey: queryKeys.paths.list(updated.org_id) })
  }

  return { accessToken, store }
}
