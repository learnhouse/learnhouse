'use client'
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import { getUriWithOrg } from '@services/config/config'
import { Info } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import OrgEditGeneral from '@components/Dashboard/Org/OrgEditGeneral/OrgEditGeneral'

export type OrgParams = {
  subpage: string
  orgslug: string
}

function OrgPage({ params }: { params: OrgParams }) {
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')

  function handleLabels() {
    if (params.subpage == 'general') {
      setH1Label('General')
      setH2Label('Manage your organization settings')
    }
  }

  useEffect(() => {
    handleLabels()
  }, [params.subpage, params])

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="pl-10 pr-10  tracking-tight bg-[#fcfbfc] shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
        <BreadCrumbs type="org"></BreadCrumbs>
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
          <Link
            href={
              getUriWithOrg(params.orgslug, '') + `/dash/org/settings/general`
            }
          >
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${
                params.subpage.toString() === 'general'
                  ? 'border-b-4'
                  : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <Info size={16} />
                <div>General</div>
              </div>
            </div>
          </Link>
        </div>
      </div>
      <div className="h-6"></div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
      >
        {params.subpage == 'general' ? <OrgEditGeneral /> : ''}
      </motion.div>
    </div>
  )
}

export default OrgPage
