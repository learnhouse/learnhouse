import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getSuperadminStatus } from '@services/ee/superadmin'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export default function useSuperadminStatus() {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.superadmin.status(),
    queryFn: () => getSuperadminStatus(accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return {
    isSuperadmin: data?.is_superadmin === true,
    isLoading,
    isError: !!error,
  }
}
