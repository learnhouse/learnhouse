'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingBar from '@components/Dashboard/Onboarding/OnboardingBar';
import WelcomeModal from '@components/Dashboard/Onboarding/WelcomeModal';
import FreePlanUpgradeBanner from '@components/Dashboard/Shared/PlanRestricted/FreePlanUpgradeBanner';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import { AtlasMiniProvider } from '@components/Dashboard/Atlas/AtlasMiniContext'
import React from 'react'
import { useMediaQuery } from 'usehooks-ts';

function ClientAdminLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: any
}) {
    const isMobile = useMediaQuery('(max-width: 1024px)')

    return (
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <CommandPaletteProvider>
                    <AtlasMiniProvider>
                        {isMobile && <DashMobileMenu />}
                        <div className="flex flex-col lg:flex-row">
                            {!isMobile && <DashLeftMenu />}
                            <div className="flex flex-col w-full relative isolate pb-24 lg:pb-0">
                                <FreePlanUpgradeBanner />
                                {children}
                                <OnboardingBar />
                            </div>
                            <WelcomeModal />
                            <CommandPalette />
                        </div>
                    </AtlasMiniProvider>
                </CommandPaletteProvider>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
