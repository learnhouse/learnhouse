import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import {
  createSampleDataInstall,
  updateInstall,
} from '@services/install/install'
import { swrFetcher } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import React from 'react'
import useSWR from 'swr'

function SampleData() {
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

  function createSampleData() {
    try {
      const username = install.data[3].username
      const slug = install.data[1].slug

      createSampleDataInstall(username, slug)

      const install_data = { ...install.data, 4: { status: 'OK' } }
      updateInstall(install_data, 5)

      router.push('/install?step=5')
    } catch (e) {}
  }

  return (
    <div className="flex items-center justify-center space-x-3 py-10">
      <h1>Install Sample data on your organization </h1>
      <div
        onClick={createSampleData}
        className="text-pruple-900 rounded-lg bg-purple-200 p-3 font-bold hover:cursor-pointer"
      >
        Start
      </div>
    </div>
  )
}

export default SampleData
