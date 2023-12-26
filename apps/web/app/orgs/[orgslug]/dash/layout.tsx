import SessionProvider from '@components/Contexts/SessionContext'
import LeftMenu from '@components/Dashboard/UI/LeftMenu'
import React from 'react'

function DashboardLayout({ children, params }: { children: React.ReactNode, params: any }) {
    return (
        <>
            <SessionProvider>
                <div className='flex'>
                <LeftMenu/>
                <div className='flex w-full'>
                {children}
                </div>
                </div>
            </SessionProvider>
        </>
    )
}

export default DashboardLayout