import { getAPIUrl } from '@services/config/config'
import { updateInstall } from '@services/install/install'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import React from 'react'
import useSWR from 'swr'

const Finish = () => {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const {
    data: install,
    error: error,
    isLoading,
  } = useSWR(`${getAPIUrl()}install/latest`, (url) => swrFetcher(url, access_token))
  const router = useRouter()

  async function finishInstall() {
    let install_data = { ...install.data, 5: { status: 'OK' } }

    let data = await updateInstall(install_data, 6)
    if (data) {
      router.push('/install?step=6')
    } else {
    }
  }

  return (
    <div className="flex py-10 justify-center items-center space-x-3">
      <h1>Installation Complete</h1>
      <br />
      <Check size={32} />
      <div
        onClick={finishInstall}
        className="p-3  font-bold bg-gray-200 text-gray-900 rounded-lg hover:cursor-pointer"
      >
        Next Step
      </div>
    </div>
  )
}

export default Finish
