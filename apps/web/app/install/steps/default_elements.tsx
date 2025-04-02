import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { createDefaultElements, updateInstall } from '@services/install/install'
import { swrFetcher } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'

function DefaultElements() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const {
    data: install,
    error,
    isLoading,
  } = useSWR(`${getAPIUrl()}install/latest`, (url) =>
    swrFetcher(url, access_token)
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const router = useRouter()

  function createDefElementsAndUpdateInstall() {
    try {
      createDefaultElements()
      // add an {} to the install.data object

      const install_data = { ...install.data, 2: { status: 'OK' } }

      updateInstall(install_data, 3)
      // await 2 seconds
      setTimeout(() => {
        setIsSubmitting(false)
      }, 2000)

      router.push('/install?step=3')
      setIsSubmitted(true)
    } catch (e) {}
  }

  return (
    <div className="flex items-center justify-center space-x-3 py-10">
      <h1>Install Default Elements </h1>
      <div
        onClick={createDefElementsAndUpdateInstall}
        className="rounded-lg bg-gray-200 p-3 font-bold text-gray-900 hover:cursor-pointer"
      >
        Install
      </div>
    </div>
  )
}

export default DefaultElements
