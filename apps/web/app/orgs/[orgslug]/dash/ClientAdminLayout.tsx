'use client';
import DashLeftMenu from '@components/Dashboard/UI/DashLeftMenu'
import DashMobileMenu from '@components/Dashboard/UI/DashMobileMenu'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionProvider } from 'next-auth/react'
import React, { useState, useEffect } from 'react'
import { useMediaQuery } from 'usehooks-ts';

function ClientAdminLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: any
}) {
    const isMobile = useMediaQuery('(max-width: 768px)')

    return (
        <SessionProvider>
            <AdminAuthorization authorizationMode="page">
                <div className="flex flex-col md:flex-row">
                    {isMobile ? (
                        <DashMobileMenu />
                    ) : (
                        <DashLeftMenu />
                    )}
                    <div className="flex w-full">{children}</div>
                </div>
            </AdminAuthorization>
        </SessionProvider>
    )
}

export default ClientAdminLayout
