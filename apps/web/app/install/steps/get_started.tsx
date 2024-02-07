import PageLoading from '@components/Objects/Loaders/PageLoading';
import { getAPIUrl } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';
import { useRouter } from 'next/navigation';
import React, { useEffect } from 'react'
import useSWR, { mutate } from "swr";

function GetStarted() {
    const { data: install, error: error, isLoading } = useSWR(`${getAPIUrl()}install/latest`, swrFetcher);
    const router = useRouter()

    async function startInstallation() {
        let res = await fetch(`${getAPIUrl()}install/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        })

        if (res.status == 200) {
            mutate(`${getAPIUrl()}install/latest`)
            router.refresh();
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


    if (error) return <div className='flex py-10 justify-center items-center space-x-3'>
        <h1>Start a new installation</h1>
        <div onClick={startInstallation} className='p-3  font-bold bg-green-200 text-green-900 rounded-lg hover:cursor-pointer' >
            Start
        </div>
    </div>

    if (isLoading) return <PageLoading />
    if (install) {
        return (
            <div>
                <div className='flex py-10 justify-center items-center space-x-3'>
                    <h1>You already started an installation</h1>
                    <div onClick={redirectToStep} className='p-3  font-bold bg-orange-200 text-orange-900 rounded-lg hover:cursor-pointer' >
                        Continue
                    </div>
                    <div onClick={startInstallation} className='p-3  font-bold bg-green-200 text-green-900 rounded-lg hover:cursor-pointer' >
                        Start
                    </div>
                </div>
            </div>
        )
    }
}

export default GetStarted