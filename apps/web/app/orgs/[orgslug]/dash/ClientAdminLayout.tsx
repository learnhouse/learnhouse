'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import { useOnboarding } from '@components/Hooks/useOnboarding';
import DemoBanner from '@components/Objects/Demo/DemoBanner';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import { UpgradeModalProvider } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { AtlasMiniProvider } from '@ee/components/Atlas/AtlasMiniContext'
import React from 'react'
import { useMediaQuery } from 'usehooks-ts';
import dynamic from 'next/dynamic'

const WelcomeModal = dynamic(() => import('@components/Dashboard/Onboarding/WelcomeModal'), { ssr: false })

// Most admins have already seen the welcome modal; don't load its globe and
// animation code for them.
function WelcomeModalGate() {
    const { welcomeSeen, dismissed } = useOnboarding()
    if (welcomeSeen || dismissed) return null
    return <WelcomeModal />
}

function ClientAdminLayout({
    children,
}: {
    children: React.ReactNode
    // Accepted (the server layout passes it) but unused here.
    params?: any
}) {
    const isMobile = useMediaQuery('(max-width: 1023px)')

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
                                <WelcomeModalGate />
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
