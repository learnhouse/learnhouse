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
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { isOSSMode } from '@services/config/config'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

export type PaymentsParams = {
  subpage: string
  orgslug: string
}

function PaymentsPage(props: { params: Promise<PaymentsParams> }) {
  const params = use(props.params);
  const _session = useLHSession() as any
  const org = useOrg() as any
  const subpage = params.subpage || 'overview'
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

  // Fire the gate-blocked impression for the deterministic OSS block.
  useTrackView(
    AnalyticsEvent.PaymentsFeatureGateBlocked,
    { is_oss: true, subpage },
    isOSSMode(),
    'dashboard',
  )

  // Gate 1: OSS deployment → payments is EE-only, blocked entirely
  if (isOSSMode()) {
    return (
      <FeatureGate feature="payments">
        <></>
      </FeatureGate>
    )
  }

  const tabs: DashTabItem[] = [
    {
      key: 'overview',
      label: 'Overview',
      icon: <Users size={16} />,
      href: getUriWithOrg(params.orgslug, '/dash/payments/overview'),
      active: subpage === 'overview',
    },
    {
      key: 'offers',
      label: 'Offers',
      icon: <Gem size={16} />,
      href: getUriWithOrg(params.orgslug, '/dash/payments/offers'),
      active: subpage === 'offers',
    },
    {
      key: 'groups',
      label: 'Payment Groups',
      icon: <Layers size={16} />,
      href: getUriWithOrg(params.orgslug, '/dash/payments/groups'),
      active: subpage === 'groups',
    },
    {
      key: 'configuration',
      label: 'Configuration',
      icon: <Settings size={16} />,
      href: getUriWithOrg(params.orgslug, '/dash/payments/configuration'),
      active: subpage === 'configuration',
    },
  ]

  // Gate 2: plan-based restriction for cloud users (standard required)
  return (
    <FeatureGate feature="payments">
    <div className="h-screen w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Payments', href: '/dash/payments', icon: <CreditCard size={14} /> }
          ]} />
        </div>
        <div className="my-2 py-2 flex flex-wrap gap-2 items-end justify-between">
          <div className="flex flex-col space-y-1 min-w-0">
            <div className="pt-3 flex font-bold text-3xl sm:text-4xl tracking-tighter truncate">
              {h1}
            </div>
            <div className="flex font-medium text-gray-400 text-md truncate">
              {h2}
            </div>
          </div>
          <div className="flex items-center space-x-2 pb-1 shrink-0">
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
        <DashTabBar tabs={tabs} />
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
    </FeatureGate>
  )
}

export default PaymentsPage
