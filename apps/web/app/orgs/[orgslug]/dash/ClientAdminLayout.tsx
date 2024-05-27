'use client';
import LeftMenu from '@components/Dashboard/UI/LeftMenu'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionProvider } from 'next-auth/react'
import React from 'react'

function ClientAdminLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: any
}) {
    return (
        <SessionProvider>
            <AdminAuthorization authorizationMode="page">
                <div className="flex">
                    <LeftMenu />
                    <div className="flex w-full">{children}</div>
                </div>
            </AdminAuthorization>
        </SessionProvider>
    )
}

export default ClientAdminLayout