'use client'
import React, { use } from 'react';
import { motion } from 'framer-motion'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { Settings, Users, Gem, CreditCard } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PaymentsConfigurationPage from '@components/Dashboard/Pages/Payments/PaymentsConfigurationPage'
import PaymentsProductPage from '@components/Dashboard/Pages/Payments/PaymentsProductPage'
import PaymentsCustomersPage from '@components/Dashboard/Pages/Payments/PaymentsCustomersPage'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import { PlanLevel } from '@services/plans/plans'
import { BadgeDollarSign } from 'lucide-react'

export type PaymentsParams = {
  subpage: string
  orgslug: string
}

function PaymentsPage(props: { params: Promise<PaymentsParams> }) {
  const params = use(props.params);
  const session = useLHSession() as any
  const org = useOrg() as any
  const subpage = params.subpage || 'customers'
  const currentPlan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  const getPageTitle = () => {
    switch (subpage) {
      case 'customers':
        return {
          h1: 'Customers',
          h2: 'View and manage your customer information'
        }
      case 'paid-products':
        return {
          h1: 'Paid Products',
          h2: 'Manage your paid products and pricing'
        }
      case 'configuration':
        return {
          h1: 'Payment Configuration',
          h2: 'Set up and manage your payment gateway'
        }
      default:
        return {
          h1: 'Payments',
          h2: 'Overview of your payment settings and transactions'
        }
    }
  }

  const { h1, h2 } = getPageTitle()

  return (
    <PlanRestrictedFeature
      currentPlan={currentPlan}
      requiredPlan="standard"
      icon={BadgeDollarSign}
      titleKey="common.plans.feature_restricted.payments.title"
      descriptionKey="common.plans.feature_restricted.payments.description"
      fullScreen
    >
    <FeatureDisabledView featureName="payments" orgslug={params.orgslug} context="dashboard">
    <div className="h-screen w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Payments', href: '/dash/payments', icon: <CreditCard size={14} /> }
          ]} />
        </div>
        <div className="my-2 py-2">
          <div className="w-100 flex flex-col space-y-1">
            <div className="pt-3 flex font-bold text-4xl tracking-tighter">
              {h1}
            </div>
            <div className="flex font-medium text-gray-400 text-md">
              {h2}
            </div>
          </div>
        </div>
        <div className="flex space-x-0.5 font-black text-sm">
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/customers')}
            icon={<Users size={16} />}
            label="Customers"
            isActive={subpage === 'customers'}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/paid-products')}
            icon={<Gem size={16} />}
            label="Products & Subscriptions"
            isActive={subpage === 'paid-products'}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/configuration')}
            icon={<Settings size={16} />}
            label="Configuration"
            isActive={subpage === 'configuration'}
          />
        </div>
      </div>
      <div className="h-6 flex-shrink-0"></div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="flex-1 overflow-y-auto"
      >
        {subpage === 'configuration' && <PaymentsConfigurationPage />}
        {subpage === 'paid-products' && <PaymentsProductPage />}
        {subpage === 'customers' && <PaymentsCustomersPage />}
      </motion.div>
    </div>
    </FeatureDisabledView>
    </PlanRestrictedFeature>
  )
}

const TabLink = ({ href, icon, label, isActive }: { href: string, icon: React.ReactNode, label: string, isActive: boolean }) => (
  <Link href={href}>
    <div
      className={`py-2 w-fit text-center border-black transition-all ease-linear ${isActive ? 'border-b-4' : 'opacity-50'} cursor-pointer`}
    >
      <div className="flex items-center space-x-2.5 mx-2">
        {icon}
        <div>{label}</div>
      </div>
    </div>
  </Link>
)

export default PaymentsPage
