import PageLoading from '@components/Objects/Loaders/PageLoading'
import React from 'react'

function DashboardHome() {
    return (
        <div className="flex items-center justify-center mx-auto min-h-screen flex-col space-x-3">
            <PageLoading />
            <div className='text-neutral-400 font-bold animate-pulse text-2xl'>This page is work in progress</div>
        </div>
    )
}

export default DashboardHome