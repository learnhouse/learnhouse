'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import WelcomeModal from '@components/Dashboard/Onboarding/WelcomeModal';
import DemoBanner from '@components/Objects/Demo/DemoBanner';
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
                        {/* This is the ORIGINAL translation opt-out, not a copy
                            of the one on <body>. It landed in 4080d4ca on
                            2026-07-25; the document-root translate="no" in
                            app/layout.tsx came later, during the 2026-08 Sentry
                            sweep. Dating it matters: because the dash was
                            already opted out here — with both the attribute and
                            the class — a month before LEARNHOUSE-WEB-6A first
                            fired on 2026-08-24, browser translation cannot be
                            what crashed the dash routes in that issue. See the
                            comment in app/layout.tsx; 6A/5M/6J stay open.

                            The `notranslate` class is deliberate HERE and
                            deliberately absent on <body>: it makes a translation
                            traversal skip the subtree outright, with no way for
                            a descendant to opt back in. That is what we want for
                            the dashboard chrome, and exactly what we must not
                            have at the root, where DynamicCanva re-enables
                            translation for learner-facing course prose.

                            Known consequence, not a hypothetical: /dash/boards
                            embeds authored course content inside this div —
                            Dashboard/Boards/Extensions/ActivityBlockComponent
                            lazy-loads DynamicCanva — so DynamicCanva's
                            translate="yes" is already inert there. Board embeds
                            are author-side previews, so that is acceptable; the
                            learner-facing course pages are outside this div and
                            stay translatable. If board embeds ever need to be
                            translatable, drop the class here (keeping the
                            attribute) rather than moving the re-enable. */}
                        <div translate="no" className="notranslate flex flex-col lg:flex-row">
                            {!isMobile && <DashLeftMenu />}
                            <div className="flex flex-col w-full min-w-0 relative isolate pb-24 lg:pb-0">
                                {/* Renders nothing outside the demo organization. */}
                                <DemoBanner />
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
