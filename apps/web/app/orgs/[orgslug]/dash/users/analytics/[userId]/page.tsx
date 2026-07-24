'use client'
import React, { use, useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { getUriWithOrg } from '@services/config/config'
import { ArrowLeft, Users } from 'lucide-react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import UserDossier from '@components/Dashboard/Pages/Users/UserAnalytics/UserDossier'
import { useUserDossier } from '@components/Dashboard/Pages/Users/UserAnalytics/useUserAudit'

type PageParams = { orgslug: string; userId: string }

const RANGES = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
]

export default function UserAnalyticsDetailPage(props: { params: Promise<PageParams> }) {
  const params = use(props.params)
  const userId = Number(params.userId)
  const [days, setDays] = useState(365)
  const { data, isLoading, isError } = useUserDossier(userId, days)

  const backHref = getUriWithOrg(params.orgslug, '') + '/dash/users/settings/users'

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1 overflow-hidden">
      <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Users', href: '/dash/users/settings/users', icon: <Users size={14} /> },
            { label: 'Analytics' },
          ]} />
        </div>
        <div className="my-2 py-3 flex items-center justify-between gap-3">
          <Link href={backHref} className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-800">
            <ArrowLeft size={16} /> Back to students
          </Link>
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setDays(r.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === r.value ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="min-w-0 overflow-y-auto overflow-x-hidden px-4 sm:px-10 py-6"
      >
        {isLoading && <div className="py-24 flex justify-center"><LearnHouseSpinner /></div>}
        {isError && <div className="py-24 text-center text-sm text-gray-500">Failed to load the student dossier.</div>}
        {data && !isLoading && <UserDossier dossier={data} />}
      </motion.div>
    </div>
  )
}
