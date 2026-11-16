'use client'
import React, { use, useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import toast from 'react-hot-toast'
import { ArrowLeft, Medal, BookOpen, Book, ArrowSquareOut, Info, ListNumbers, CircleNotch, Circuitry as PathIcon, Users, MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY } from '@components/Dashboard/Shared/DashKit/DashKit'
import EditPathGeneral from '@components/Dashboard/Pages/Path/EditPathGeneral'
import EditPathCourses from '@components/Dashboard/Pages/Path/EditPathCourses'
import EditPathCertificate from '@components/Dashboard/Pages/Path/EditPathCertificate'
import PathLearners from '@components/Dashboard/Pages/Path/PathLearners'
import { PathSeoTab } from '@components/Dashboard/Shared/SEO/ResourceSeoTabs'
import { usePathCache } from '@components/Dashboard/Pages/Path/usePathSave'
import { PathStatusChip } from '../../../_components/PathDashItems'
import { getUriWithOrg } from '@services/config/config'
import { Path, updatePath } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { usePath } from '@/hooks/queries/usePaths'

export type PathEditorParams = {
  orgslug: string
  pathuuid: string
  subpage: string
}

// Header actions shrink a little on phones so both fit on one line.
const HEADER_BTN = 'max-sm:h-9 max-sm:px-3'

function PathEditorPage(props: { params: Promise<PathEditorParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)
  const fullUuid = `path_${params.pathuuid}`
  const { data: path, isLoading } = usePath(fullUuid)

  const tabs = [
    { key: 'general', label: t('paths.dashboard.tabs.general'), icon: Info },
    { key: 'courses', label: t('paths.dashboard.tabs.courses'), icon: ListNumbers },
    { key: 'certificate', label: t('paths.dashboard.tabs.certificate'), icon: Medal },
    { key: 'learners', label: t('paths.dashboard.tabs.learners'), icon: Users },
    { key: 'seo', label: t('dashboard.courses.settings.tabs.seo'), icon: MagnifyingGlass },
  ]

  return (
    <FeatureGate feature="paths" orgslug={params.orgslug} context="dashboard">
      <div className="h-screen w-full grid grid-rows-[auto_1fr] grid-cols-1">
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
              {params.subpage === 'seo' && <PathSeoTab path={path} orgslug={params.orgslug} />}
            </div>
          )}
        </motion.div>
      </div>
    </FeatureGate>
  )
}

function PublishToggle({ path }: { path: Path }) {
  const { t } = useTranslation()
  const { accessToken, store } = usePathCache()
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    const next = !path.published
    setBusy(true)
    try {
      store(await updatePath(path.path_uuid, { published: next }, accessToken))
      toast.success(next ? t('paths.dashboard.header.published_toast') : t('paths.dashboard.header.unpublished_toast'))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    } finally {
      setBusy(false)
    }
  }

  const Icon = busy ? CircleNotch : path.published ? Book : BookOpen
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`${path.published ? BTN_SECONDARY : BTN_PRIMARY} ${HEADER_BTN}`}
    >
      <Icon size={16} className={busy ? 'animate-spin' : ''} />
      {path.published ? t('paths.dashboard.header.unpublish') : t('paths.dashboard.header.publish')}
    </button>
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
      <header className="bg-white nice-shadow relative z-10 px-4 sm:px-10 animate-pulse">
        <div className="pt-4 sm:pt-6 pb-4">
          <div className="h-4 w-40 bg-neutral-100 rounded" />
          <div className="flex items-center gap-3 mt-4">
            <div className="w-9 h-9 bg-neutral-100 rounded-xl" />
            <div className="h-7 w-56 bg-neutral-100 rounded-lg" />
            <div className="h-6 w-20 bg-neutral-100 rounded-full" />
          </div>
        </div>
        <div className="flex gap-3 pb-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-24 bg-neutral-100 rounded-lg" />
          ))}
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white nice-shadow relative z-10 px-4 sm:px-10">
      <div className="pt-4 sm:pt-6 pb-1.5 sm:pb-2">
        <Breadcrumbs
          items={[
            { label: t('paths.title'), href: '/dash/paths', icon: <PathIcon size={14} /> },
            { label: path.name, href: `/dash/paths/path/${params.pathuuid}/general` },
          ]}
        />
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={getUriWithOrg(params.orgslug, '/dash/paths')}
              className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 transition-colors shrink-0"
              aria-label={t('paths.back_to_paths')}
            >
              <ArrowLeft size={18} className="rtl:rotate-180" />
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 truncate min-w-0" dir="auto">
              {path.name}
            </h1>
            <span className="shrink-0">
              <PathStatusChip published={path.published} />
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={getUriWithOrg(params.orgslug, `/path/${params.pathuuid}`)}
              target="_blank"
              className={`${BTN_GHOST} ${HEADER_BTN}`}
            >
              <ArrowSquareOut size={16} />
              {t('paths.dashboard.view_path')}
            </Link>
            <PublishToggle path={path} />
          </div>
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
    </header>
  )
}

export default PathEditorPage
