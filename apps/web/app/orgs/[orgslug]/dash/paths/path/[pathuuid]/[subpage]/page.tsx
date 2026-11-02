'use client'
import React, { use } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { ArrowLeft, Award, Info, ListOrdered, Route, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import EditPathGeneral from '@components/Dashboard/Pages/Path/EditPathGeneral'
import EditPathCourses from '@components/Dashboard/Pages/Path/EditPathCourses'
import EditPathCertificate from '@components/Dashboard/Pages/Path/EditPathCertificate'
import PathLearners from '@components/Dashboard/Pages/Path/PathLearners'
import { getUriWithOrg } from '@services/config/config'
import { Path } from '@services/paths/paths'
import { usePath } from '@/hooks/queries/usePaths'

export type PathEditorParams = {
  orgslug: string
  pathuuid: string
  subpage: string
}

function PathEditorPage(props: { params: Promise<PathEditorParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)
  const fullUuid = `path_${params.pathuuid}`
  const { data: path, isLoading } = usePath(fullUuid)

  const tabs = [
    { key: 'general', label: t('paths.dashboard.tabs.general'), icon: Info },
    { key: 'courses', label: t('paths.dashboard.tabs.courses'), icon: ListOrdered },
    { key: 'certificate', label: t('paths.dashboard.tabs.certificate'), icon: Award },
    { key: 'learners', label: t('paths.dashboard.tabs.learners'), icon: Users },
  ]

  return (
    <FeatureGate feature="paths" orgslug={params.orgslug} context="dashboard">
      <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1">
        <PathEditorHeader params={params} path={path} isLoading={isLoading} tabs={tabs} />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
          className="h-full overflow-y-auto"
        >
          {path && (
            <div className="pb-10">
              {params.subpage === 'general' && <EditPathGeneral path={path} />}
              {params.subpage === 'courses' && <EditPathCourses path={path} orgslug={params.orgslug} />}
              {params.subpage === 'certificate' && <EditPathCertificate path={path} />}
              {params.subpage === 'learners' && <PathLearners path={path} orgslug={params.orgslug} />}
            </div>
          )}
        </motion.div>
      </div>
    </FeatureGate>
  )
}

function PathEditorHeader({
  params,
  path,
  isLoading,
  tabs,
}: {
  params: PathEditorParams
  path?: Path
  isLoading: boolean
  tabs: { key: string; label: string; icon: any }[]
}) {
  const { t } = useTranslation()

  if (isLoading || !path) {
    return (
      <div className="ps-10 pe-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative animate-pulse">
        <div className="pt-6 pb-4">
          <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
          <div className="flex items-center space-x-4 mt-4">
            <div className="w-9 h-9 bg-gray-200 rounded-lg" />
            <div className="h-7 w-48 bg-gray-200 rounded" />
          </div>
        </div>
        <div className="flex space-x-3 pb-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="ps-4 pe-4 sm:ps-10 sm:pe-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative">
      <div className="pt-6 pb-4">
        <Breadcrumbs
          items={[
            { label: t('paths.title'), href: '/dash/paths', icon: <Route size={14} /> },
            { label: path.name, href: `/dash/paths/path/${params.pathuuid}/general` },
          ]}
        />
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center space-x-4 min-w-0">
            <Link
              href={getUriWithOrg(params.orgslug, '/dash/paths')}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label={t('paths.title')}
            >
              <ArrowLeft size={20} className="rtl:rotate-180" />
            </Link>
            <h1 className="text-2xl font-bold truncate" dir="auto">{path.name}</h1>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full ${
                path.published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {path.published ? t('paths.published') : t('paths.draft')}
            </span>
          </div>
          <Link
            href={getUriWithOrg(params.orgslug, `/path/${params.pathuuid}`)}
            target="_blank"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors shrink-0"
          >
            {t('paths.dashboard.view_path')} &rarr;
          </Link>
        </div>
      </div>
      <DashTabBar
        tabs={tabs.map((tab) => {
          const IconComponent = tab.icon
          return {
            key: tab.key,
            label: tab.label,
            icon: <IconComponent size={16} />,
            href: getUriWithOrg(params.orgslug, '') + `/dash/paths/path/${params.pathuuid}/${tab.key}`,
            active: params.subpage === tab.key,
          } as DashTabItem
        })}
      />
    </div>
  )
}

export default PathEditorPage
