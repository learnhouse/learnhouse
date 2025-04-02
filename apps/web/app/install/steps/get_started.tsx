import { useLHSession } from '@components/Contexts/LHSessionContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import useSWR, { mutate } from 'swr'

function GetStarted() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const {
    data: install,
    error,
    isLoading,
  } = useSWR(`${getAPIUrl()}install/latest`, (url) =>
    swrFetcher(url, access_token)
  )
  const router = useRouter()

  async function startInstallation() {
    const res = await fetch(`${getAPIUrl()}install/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    if (res.status == 200) {
      mutate(`${getAPIUrl()}install/latest`)
      router.refresh()
      router.push(`/install?step=1`)
    }
  }

  function redirectToStep() {
    const step = install.step
    router.push(`/install?step=${step}`)
  }

  useEffect(() => {
    if (install) {
      redirectToStep()
    }
  }, [install])

  if (error)
    return (
      <div className="flex items-center justify-center space-x-3 py-10">
        <h1>Start a new installation</h1>
        <div
          onClick={startInstallation}
          className="rounded-lg bg-green-200 p-3 font-bold text-green-900 hover:cursor-pointer"
        >
          Start
        </div>
      </div>
    )

  if (isLoading) return <PageLoading />
  if (install) {
    return (
      <div>
        <div className="flex items-center justify-center space-x-3 py-10">
          <h1>You already started an installation</h1>
          <div
            onClick={redirectToStep}
            className="rounded-lg bg-orange-200 p-3 font-bold text-orange-900 hover:cursor-pointer"
          >
            Continue
          </div>
          <div
            onClick={startInstallation}
            className="rounded-lg bg-green-200 p-3 font-bold text-green-900 hover:cursor-pointer"
          >
            Start
          </div>
        </div>
      </div>
    )
  }
}

export default GetStarted
