'use client'
import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { CreditCard, Settings, Repeat, BookOpen, Users, DollarSign } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PaymentsConfigurationPage from '@components/Dashboard/Payments/PaymentsConfigurationPage'
import PaymentsProductPage from '@components/Dashboard/Payments/PaymentsProductPage'



export type PaymentsParams = {
  subpage: string
  orgslug: string
}

function PaymentsPage({ params }: { params: PaymentsParams }) {
  const session = useLHSession() as any
  const org = useOrg() as any
  const [selectedSubPage, setSelectedSubPage] = useState(params.subpage || 'general')
  const [H1Label, setH1Label] = useState('')
  const [H2Label, setH2Label] = useState('')

  useEffect(() => {
    handleLabels()
  }, [selectedSubPage])

  function handleLabels() {
    if (selectedSubPage === 'general') {
      setH1Label('Payments')
      setH2Label('Overview of your payment settings and transactions')
    }
    if (selectedSubPage === 'configuration') {
      setH1Label('Payment Configuration')
      setH2Label('Set up and manage your payment gateway')
    }
    if (selectedSubPage === 'subscriptions') {
      setH1Label('Subscriptions')
      setH2Label('Manage your subscription plans')
    }
    if (selectedSubPage === 'paid-products') {
      setH1Label('Paid Products')
      setH2Label('Manage your paid products and pricing')
    }
    if (selectedSubPage === 'customers') {
      setH1Label('Customers')
      setH2Label('View and manage your customer information')
    }
  }

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
        <BreadCrumbs type="payments" />
        <div className="my-2  py-3">
          <div className="w-100 flex flex-col space-y-1">
            <div className="pt-3 flex font-bold text-4xl tracking-tighter">
              {H1Label}
            </div>
            <div className="flex font-medium text-gray-400 text-md">
              {H2Label}{' '}
            </div>
          </div>
        </div>
        <div className="flex space-x-5 font-black text-sm">
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/customers')}
            icon={<Users size={16} />}
            label="Customers"
            isActive={selectedSubPage === 'customers'}
            onClick={() => setSelectedSubPage('customers')}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/paid-products')}
            icon={<BookOpen size={16} />}
            label="One-time Products"
            isActive={selectedSubPage === 'paid-products'}
            onClick={() => setSelectedSubPage('paid-products')}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/subscriptions')}
            icon={<Repeat size={16} />}
            label="Subscriptions"
            isActive={selectedSubPage === 'subscriptions'}
            onClick={() => setSelectedSubPage('subscriptions')}
          />
          <TabLink
            href={getUriWithOrg(params.orgslug, '/dash/payments/configuration')}
            icon={<Settings size={16} />}
            label="Configuration"
            isActive={selectedSubPage === 'configuration'}
            onClick={() => setSelectedSubPage('configuration')}
          />

        </div>
      </div>
      <div className="h-6"></div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="h-full overflow-y-auto"
      >
        {selectedSubPage === 'general' && <div>General</div>}
        {selectedSubPage === 'configuration' && <PaymentsConfigurationPage />}
        {selectedSubPage === 'paid-products' && <PaymentsProductPage />}
        {selectedSubPage === 'subscriptions' && <div>Subscriptions</div>}
        {selectedSubPage === 'customers' && <div>Customers</div>}
      </motion.div>
    </div>
  )
}

const TabLink = ({ href, icon, label, isActive, onClick }: { href: string, icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void }) => (
  <Link href={href}>
    <div
      onClick={onClick}
      className={`py-2 w-fit text-center border-black transition-all ease-linear ${isActive ? 'border-b-4' : 'opacity-50'
        } cursor-pointer`}
    >
      <div className="flex items-center space-x-2.5 mx-2">
        {icon}
        <div>{label}</div>
      </div>
    </div>
  </Link>
)

export default PaymentsPage
