'use client'
import React, { use } from 'react';
import { motion } from 'motion/react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { Settings, Users, Gem, CreditCard, Layers, ShoppingBag, ExternalLink } from 'lucide-react'
import { SiStripe } from '@icons-pack/react-simple-icons'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PaymentsConfigurationPage from '@components/Dashboard/Pages/Payments/PaymentsConfigurationPage'
import PaymentsCustomersPage from '@components/Dashboard/Pages/Payments/PaymentsCustomersPage'
import PaymentsOffersPage from '@components/Dashboard/Pages/Payments/PaymentsOffersPage'
import PaymentsGroupsPage from '@components/Dashboard/Pages/Payments/PaymentsGroupsPage'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import { PlanLevel } from '@services/plans/plans'
import { BadgeDollarSign } from 'lucide-react'
import { isOSSMode } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'

export type PaymentsParams = {
  subpage: string
  orgslug: string
}

function PaymentsPage(props: { params: Promise<PaymentsParams> }) {
  const params = use(props.params);
  const session = useLHSession() as any
  const org = useOrg() as any
  const subpage = params.subpage || 'overview'
  const currentPlan = usePlan()

  const getPageTitle = () => {
    switch (subpage) {
      case 'overview':
        return {
          h1: 'Overview',
          h2: 'Revenue, transactions, subscriptions and customers'
        }
      case 'offers':
        return {
          h1: 'Offers',
          h2: 'Manage your offers and subscriptions'
        }
      case 'groups':
        return {
          h1: 'Payment Groups',
          h2: 'Bundle resources for subscriptions and multi-course offers'
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
  const paymentsEnabled = org?.config?.config?.resolved_features?.payments?.enabled ?? org?.config?.config?.features?.payments?.enabled !== false

  // Gate 1: OSS deployment → payments is EE-only, blocked entirely
  if (isOSSMode()) {
    return (
      <PlanRestrictedFeature
        currentPlan={currentPlan}
        requiredPlan="enterprise"
        icon={BadgeDollarSign}
        titleKey="common.plans.feature_restricted.payments.title"
        descriptionKey="common.plans.feature_restricted.payments.description"
        fullScreen
      >
        <></>
      </PlanRestrictedFeature>
    )
  }

  // Gate 2: plan-based restriction for cloud users (standard required)
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
        <div className="my-2 py-2 flex items-end justify-between">
          <div className="w-100 flex flex-col space-y-1">
            <div className="pt-3 flex font-bold text-4xl tracking-tighter">
              {h1}
            </div>
            <div className="flex font-medium text-gray-400 text-md">
              {h2}
            </div>
          </div>
          <div className="flex items-center space-x-2 pb-1">
            {paymentsEnabled && (
              <Link
                href={getUriWithOrg(params.orgslug, '/store')}
                target="_blank"
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ShoppingBag size={14} />
                <span>Preview Shop</span>
                <ExternalLink size={12} className="text-gray-400" />
              </Link>
            )}
            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <SiStripe size={14} className="text-[#635BFF]" />
              <span>Stripe Dashboard</span>
              <ExternalLink size={12} className="text-gray-400" />
            </a>
          </div>
        </div>
        <div className="flex space-x-0.5 font-black text-sm">
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/overview')}
            icon={<Users size={16} />}
            label="Overview"
            isActive={subpage === 'overview'}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/offers')}
            icon={<Gem size={16} />}
            label="Offers"
            isActive={subpage === 'offers'}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/groups')}
            icon={<Layers size={16} />}
            label="Payment Groups"
            isActive={subpage === 'groups'}
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
        {subpage === 'offers' && <PaymentsOffersPage />}
        {subpage === 'groups' && <PaymentsGroupsPage />}
        {(subpage === 'overview' || subpage === 'customers') && <PaymentsCustomersPage />}
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
