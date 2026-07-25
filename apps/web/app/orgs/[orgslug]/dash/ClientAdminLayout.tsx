'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import WelcomeModal from '@components/Dashboard/Onboarding/WelcomeModal';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import { UpgradeModalProvider } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import React from 'react'
import { useMediaQuery } from 'usehooks-ts';

function ClientAdminLayout({
    children,
}: {
    children: React.ReactNode
    // Accepted (the server layout passes it) but unused here.
    params?: any
}) {
    const isMobile = useMediaQuery('(max-width: 1024px)')

    return (
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <CommandPaletteProvider>
                    <UpgradeModalProvider>
                        {isMobile && <DashMobileMenu />}
                        {/* Built-in page translation (Chrome/Edge/Firefox) swaps text
                            nodes out from under React. On the editor — where nodes are
                            constantly inserted and moved — that desyncs the two trees
                            and the next render dies on "insertBefore ... not a child of
                            this node", taking the whole page with it. The dashboard is
                            already translated by i18n, so opting it out costs nothing.
                            Public course pages stay translatable. */}
                        <div translate="no" className="notranslate flex flex-col lg:flex-row">
                            {!isMobile && <DashLeftMenu />}
                            <div className="flex flex-col w-full min-w-0 relative isolate pb-24 lg:pb-0">
                                {children}
                                <OnboardingTracker />
                            </div>
                            <WelcomeModal />
                            <CommandPalette />
                        </div>
                    </UpgradeModalProvider>
                </CommandPaletteProvider>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
