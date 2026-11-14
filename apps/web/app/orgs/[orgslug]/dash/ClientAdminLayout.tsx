'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import DemoBanner from '@components/Objects/Demo/DemoBanner';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import { UpgradeModalProvider } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { AtlasMiniProvider } from '@ee/components/Atlas/AtlasMiniContext'
import React from 'react'
import { usePathname } from 'next/navigation'
import { useMediaQuery } from 'usehooks-ts';
import useAdminStatus from '@components/Hooks/useAdminStatus'



function ClientAdminLayout({
    children,
}: {
    children: React.ReactNode
    // Accepted (the server layout passes it) but unused here.
    params?: any
}) {
    const isMobile = useMediaQuery('(max-width: 1023px)')
    const pathname = usePathname()
    const { isAdmin } = useAdminStatus() as any
    // A manager who is not an admin opens "My team" without the admin chrome.
    const memberOnly = isAdmin === false && ['/dash/my-team', '/dash/my-groups'].some((p) => pathname === p || !!pathname?.startsWith(`${p}/`))

    if (memberOnly) {
        return (
            <SessionGate>
                <AdminAuthorization authorizationMode="page">
                    <UpgradeModalProvider>
                        <div translate="no" className="notranslate min-h-screen bg-[#f8f8f8]">{children}</div>
                    </UpgradeModalProvider>
                </AdminAuthorization>
            </SessionGate>
        )
    }

    return (
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <CommandPaletteProvider>
                    <UpgradeModalProvider>
                        <AtlasMiniProvider>
                            {isMobile && <DashMobileMenu />}
                            {/* Built-in page translation (Chrome/Edge/Firefox) swaps text
                                nodes out from under React. On the editor, where nodes are
                                constantly inserted and moved, that desyncs the two trees
                                and the next render dies on "insertBefore ... not a child of
                                this node", taking the whole page with it. The dashboard is
                                already translated by i18n, so opting it out costs nothing.
                                Public course pages stay translatable. */}
                            <div translate="no" className="notranslate flex flex-col lg:flex-row min-h-screen bg-[#f8f8f8]">
                                {!isMobile && <DashLeftMenu />}
                                {/* Bottom padding = the mobile tab bar's height (0 on desktop). */}
                                <div className="lh-dash-main flex flex-col w-full min-w-0 relative isolate pb-[var(--lh-mobile-nav-h)] lg:pb-0">
                                    {/* Renders nothing outside the demo organization. */}
                                    <DemoBanner />
                                    {children}
                                    <OnboardingTracker />
                                </div>
                                <CommandPalette />
                            </div>
                        </AtlasMiniProvider>
                    </UpgradeModalProvider>
                </CommandPaletteProvider>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
