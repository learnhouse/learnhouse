'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import React from 'react'
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
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <div className="flex flex-col md:flex-row">
                    {isMobile ? (
                        <DashMobileMenu />
                    ) : (
                        <DashLeftMenu />
                    )}
                    <div className="flex w-full relative isolate">{children}</div>
                </div>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
