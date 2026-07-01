'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import WelcomeModal from '@components/Dashboard/Onboarding/WelcomeModal';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import React from 'react'
import { useMediaQuery } from 'usehooks-ts';

function ClientAdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const isMobile = useMediaQuery('(max-width: 1024px)')

    return (
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <CommandPaletteProvider>
                    {isMobile && <DashMobileMenu />}
                    <div className="flex flex-col lg:flex-row">
                        {!isMobile && <DashLeftMenu />}
                        <div className="flex flex-col w-full min-w-0 relative isolate pb-24 lg:pb-0">
                            {children}
                            <OnboardingTracker />
                        </div>
                        <WelcomeModal />
                        <CommandPalette />
                    </div>
                </CommandPaletteProvider>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
