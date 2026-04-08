'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import OnboardingBar from '@components/Dashboard/Onboarding/OnboardingBar';
import WelcomeModal from '@components/Dashboard/Onboarding/WelcomeModal';
import FreePlanUpgradeBanner from '@components/Dashboard/Shared/PlanRestricted/FreePlanUpgradeBanner';
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
                    <div className="flex flex-col w-full relative isolate">
                        <FreePlanUpgradeBanner />
                        {children}
                        <OnboardingBar />
                    </div>
                    <WelcomeModal />
                </div>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
