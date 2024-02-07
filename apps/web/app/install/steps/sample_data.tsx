import { getAPIUrl } from '@services/config/config';
import { createSampleDataInstall, updateInstall } from '@services/install/install';
import { swrFetcher } from '@services/utils/ts/requests';
import { useRouter } from 'next/navigation';
import React from 'react'
import useSWR from "swr";

function SampleData() {
  const { data: install, error: error, isLoading } = useSWR(`${getAPIUrl()}install/latest`, swrFetcher);
  const router = useRouter()

  function createSampleData() {

    try {
      let username = install.data[3].username
      let slug = install.data[1].slug
      
      createSampleDataInstall(username, slug)

      let install_data = { ...install.data, 4: { status: 'OK' } }
      updateInstall(install_data, 5)

      router.push('/install?step=5')

    }
    catch (e) {
      
    }
  }



  return (
    <div className='flex py-10 justify-center items-center space-x-3'>
      <h1>Install Sample data on your organization </h1>
      <div onClick={createSampleData} className='p-3  font-bold bg-purple-200 text-pruple-900 rounded-lg hover:cursor-pointer' >
        Start
      </div>
    </div>
  )
}

export default SampleData