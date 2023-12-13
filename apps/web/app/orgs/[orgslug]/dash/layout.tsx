import LeftMenu from '@components/Dashboard/UI/LeftMenu'
import AuthProvider from '@components/Security/AuthProvider'
import React from 'react'

function DashboardLayout({ children, params }: { children: React.ReactNode, params: any }) {
    return (
        <>
            <AuthProvider>
                <div className='flex'>
                <LeftMenu/>
                <div className='flex w-full'>
                {children}
                </div>
                </div>
            </AuthProvider>
        </>
    )
}

export default DashboardLayout