import { getAPIUrl } from '@services/config/config';
import { createDefaultElements, updateInstall } from '@services/install/install';
import { swrFetcher } from '@services/utils/ts/requests';
import { useRouter } from 'next/navigation';
import React from 'react'
import useSWR from "swr";

function DefaultElements() {
    const { data: install, error: error, isLoading } = useSWR(`${getAPIUrl()}install/latest`, swrFetcher);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isSubmitted, setIsSubmitted] = React.useState(false);
    const router = useRouter()

    function createDefElementsAndUpdateInstall() {
        try {
            createDefaultElements()
            // add an {} to the install.data object

            let install_data = { ...install.data, 2: { status: 'OK' } }
        
            updateInstall(install_data, 3)
            // await 2 seconds
            setTimeout(() => {
                setIsSubmitting(false)
            }, 2000)

            router.push('/install?step=3')
            setIsSubmitted(true)
        }
        catch (e) {
            
        }
    }

    return (
        <div className='flex py-10 justify-center items-center space-x-3'>
            <h1>Install Default Elements </h1>
            <div onClick={createDefElementsAndUpdateInstall} className='p-3  font-bold bg-gray-200 text-gray-900 rounded-lg hover:cursor-pointer' >
                Install
            </div>
        </div>
    )
}

export default DefaultElements