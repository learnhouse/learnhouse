import useSWR from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export default function useSuperadminStatus() {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data, error, isLoading } = useSWR(
    accessToken ? `${getAPIUrl()}ee/superadmin/status` : null,
    (url: string) => swrFetcher(url, accessToken),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  )

  return {
    isSuperadmin: data?.is_superadmin === true,
    isLoading,
    isError: !!error,
  }
}
