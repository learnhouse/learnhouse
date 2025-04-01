import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { updateInstall } from '@services/install/install'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React from 'react'
import useSWR from 'swr'

const Finish = () => {
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

  async function finishInstall() {
    const install_data = { ...install.data, 5: { status: 'OK' } }

    const data = await updateInstall(install_data, 6)
    if (data) {
      router.push('/install?step=6')
    } else {
    }
  }

  return (
    <div className="flex items-center justify-center space-x-3 py-10">
      <h1>Installation Complete</h1>
      <br />
      <Check size={32} />
      <div
        onClick={finishInstall}
        className="rounded-lg bg-gray-200 p-3 font-bold text-gray-900 hover:cursor-pointer"
      >
        Next Step
      </div>
    </div>
  )
}

export default Finish
