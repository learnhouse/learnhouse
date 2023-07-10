import { Check, Link } from 'lucide-react'
import React from 'react'

function DisableInstallMode() {
    return (
        <div className='p-4 bg-green-300 text-green-950 rounded-md flex space-x-4 items-center'>
            <div>
                <Check size={32} />
            </div>
            <div><p className='font-bold text-lg'>You have reached the end of the Installation process, <b><i>please don't forget to disable installation mode.</i></b> </p>
                <div className='flex space-x-2 items-center'>
                    <Link size={20} />
                    <a rel='noreferrer' target='_blank' className="text-blue-950 font-medium" href="http://docs.learnhouse.app">LearnHouse Docs</a>
                </div></div>
        </div>
    )
}

export default DisableInstallMode