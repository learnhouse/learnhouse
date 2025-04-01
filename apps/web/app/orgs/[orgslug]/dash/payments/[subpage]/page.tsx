'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import PaymentsConfigurationPage from '@components/Dashboard/Pages/Payments/PaymentsConfigurationPage'
import PaymentsCustomersPage from '@components/Dashboard/Pages/Payments/PaymentsCustomersPage'
import PaymentsProductPage from '@components/Dashboard/Pages/Payments/PaymentsProductPage'
import useFeatureFlag from '@components/Hooks/useFeatureFlag'
import { getUriWithOrg } from '@services/config/config'
import { motion } from 'framer-motion'
import { Gem, Settings, Users } from 'lucide-react'
import Link from 'next/link'
import type React from 'react'
import { use } from 'react'

export type PaymentsParams = {
  subpage: string
  orgslug: string
}

function PaymentsPage(props: { params: Promise<PaymentsParams> }) {
  const params = use(props.params)
  const session = useLHSession() as any
  const org = useOrg() as any
  const subpage = params.subpage || 'customers'

  const isPaymentsEnabled = useFeatureFlag({
    path: ['features', 'payments', 'enabled'],
    defaultValue: false,
  })

  const getPageTitle = () => {
    switch (subpage) {
      case 'customers':
        return {
          h1: 'Customers',
          h2: 'View and manage your customer information',
        }
      case 'paid-products':
        return {
          h1: 'Paid Products',
          h2: 'Manage your paid products and pricing',
        }
      case 'configuration':
        return {
          h1: 'Payment Configuration',
          h2: 'Set up and manage your payment gateway',
        }
      default:
        return {
          h1: 'Payments',
          h2: 'Overview of your payment settings and transactions',
        }
    }
  }

  if (!isPaymentsEnabled) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#f8f8f8] p-4">
        <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-md">
          <h2 className="mb-4 text-xl font-bold">Payments Not Available</h2>
          <p className="text-gray-600">
            The payments feature is not enabled for this organization.
          </p>
          <p className="mt-2 text-gray-600">
            Please contact your administrator to enable payments.
          </p>
        </div>
      </div>
    )
  }

  const { h1, h2 } = getPageTitle()

  return (
    <div className="flex h-screen w-full flex-col bg-[#f8f8f8]">
      <div className="nice-shadow z-10 bg-[#fcfbfc] pr-10 pl-10 tracking-tight">
        <BreadCrumbs type="payments" />
        <div className="my-2 py-2">
          <div className="flex w-100 flex-col space-y-1">
            <div className="flex pt-3 text-4xl font-bold tracking-tighter">
              {h1}
            </div>
            <div className="text-md flex font-medium text-gray-400">{h2}</div>
          </div>
        </div>
        <div className="flex space-x-0.5 text-sm font-black">
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
      <div className="h-6"></div>
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
  )
}

const TabLink = ({
  href,
  icon,
  label,
  isActive,
}: {
  href: string
  icon: React.ReactNode
  label: string
  isActive: boolean
}) => (
  <Link href={href}>
    <div
      className={`w-fit border-black py-2 text-center transition-all ease-linear ${isActive ? 'border-b-4' : 'opacity-50'} cursor-pointer`}
    >
      <div className="mx-2 flex items-center space-x-2.5">
        {icon}
        <div>{label}</div>
      </div>
    </div>
  </Link>
)

export default PaymentsPage
