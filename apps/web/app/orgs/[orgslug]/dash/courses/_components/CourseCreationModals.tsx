'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { DownloadSimple, Info, Plus } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import dynamic from 'next/dynamic'
import CourseCreationTypeSelector from '@components/Objects/Modals/Course/Create/CourseCreationTypeSelector'
import { ImportTypeSelector } from '@components/Objects/Modals/Course/Import'

// The create / AI / import flows only run once their modal opens; loading
// them on demand keeps their form, upload and AI code out of the courses
// page's first download.
const CreateCourseModal = dynamic(() => import('@components/Objects/Modals/Course/Create/CreateCourse'))
const AICourseCreationModal = dynamic(
  () => import('@components/Objects/Modals/Course/Create/AICourse/AICourseCreationModal'),
  { ssr: false }
)
// With EE the AI option opens the course builder (the same creator on the
// Atlas engine: sessions in Atlas history, runs that survive closing it).
// Open-source builds keep the classic creator above.
const CourseBuilderModal = dynamic(() => import('@ee/components/Atlas/CourseBuilder/CourseBuilderModal'), { ssr: false })
import { COURSE_BUILDER_AVAILABLE } from '@ee/components/Atlas/CourseBuilder/availability'
const LearnHouseCourseImport = dynamic(() => import('@components/Objects/Modals/Course/Import/LearnHouseCourseImport'))
const LmsCourseImport = dynamic(() => import('@components/Objects/Modals/Course/Import/LmsCourseImport'))
const ScormCourseImport = dynamic(() => import('@ee/components/Modals/ScormCourseImport'))
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { BTN_GHOST } from '@components/Dashboard/Shared/DashKit/DashKit'
import { usePlan } from '@components/Hooks/usePlan'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

type CreationStep = 'select' | 'scratch'
export type CreationType = 'scratch' | 'ai' | 'migrate'
type ImportStep = 'select' | 'scorm' | 'learnhouse' | 'lms'

// The header actions of the courses page: Import + New course, and every
// modal those open (pick how to start, the blank form, the AI builder, the
// import flavours).
export default function CourseCreationModals({
  orgslug,
  orgId,
  open,
  onOpenChange,
  limitReached,
  limit,
  onCreated,
  newCourseButton,
  startRequest,
}: {
  orgslug: string
  orgId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  limitReached: boolean
  limit: number | string
  onCreated: () => void
  newCourseButton: React.ReactNode
  /** A start option picked outside the chooser (the empty courses page);
   *  a new `id` starts that flow. */
  startRequest?: { type: CreationType; id: number } | null
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const { track } = useLHAnalytics('dashboard')
  const currentPlan = usePlan()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const [creationStep, setCreationStep] = React.useState<CreationStep>('select')
  const [aiOpen, setAiOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [importStep, setImportStep] = React.useState<ImportStep>('select')

  // Opening the chooser is the step between visiting /dash/courses and picking
  // a type; without it that drop can't be measured.
  // Starts false so a page opened with ?new=1 (chooser already open) counts.
  const wasOpen = React.useRef(false)
  React.useEffect(() => {
    if (open && !wasOpen.current) track(AnalyticsEvent.CourseCreateModalOpened, { limit_reached: limitReached })
    wasOpen.current = open
  }, [open, limitReached, track])

  const closeCreate = () => {
    onOpenChange(false)
    setCreationStep('select')
    onCreated()
  }
  const closeImport = () => {
    setImportOpen(false)
    setImportStep('select')
    onCreated()
  }

  const onSelectCreation = (type: CreationType, source: 'chooser' | 'empty_state' = 'chooser') => {
    track(AnalyticsEvent.CourseCreationTypeSelected, { creation_type: type, source })
    if (type === 'ai') {
      onOpenChange(false)
      setAiOpen(true)
    } else if (type === 'migrate') {
      onOpenChange(false)
      router.push(getUriWithOrg(orgslug, '/dash/courses/migrate'))
    } else {
      setCreationStep('scratch')
      // From the empty page the chooser isn't open yet: go straight to the form.
      if (source === 'empty_state') onOpenChange(true)
    }
  }

  const handledStart = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!startRequest || limitReached || handledStart.current === startRequest.id) return
    handledStart.current = startRequest.id
    onSelectCreation(startRequest.type, 'empty_state')
    // onSelectCreation is recreated each render; the request id gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRequest, limitReached])

  const importTitles: Record<ImportStep, string> = {
    select: t('dashboard.courses.import_course'),
    scorm: t('dashboard.courses.import_scorm'),
    learnhouse: t('dashboard.courses.import_learnhouse'),
    lms: t('dashboard.courses.import_lms'),
  }
  const importDescriptions: Record<ImportStep, string> = {
    select: t('dashboard.courses.import_select_type'),
    scorm: t('dashboard.courses.import_scorm_description'),
    learnhouse: t('dashboard.courses.import_learnhouse_description'),
    lms: t('dashboard.courses.import_lms_description'),
  }

  const importContent = () => {
    switch (importStep) {
      case 'scorm':
        return (
          <FeatureGate feature="scorm" orgslug={orgslug} context="dashboard">
            <ScormCourseImport orgId={orgId} orgslug={orgslug} closeModal={closeImport} />
          </FeatureGate>
        )
      case 'learnhouse':
        return <LearnHouseCourseImport orgId={orgId} orgslug={orgslug} closeModal={closeImport} />
      case 'lms':
        return <LmsCourseImport orgId={orgId} orgslug={orgslug} closeModal={closeImport} />
      default:
        return <ImportTypeSelector onSelectType={setImportStep} currentPlan={currentPlan} />
    }
  }

  return (
    <>
      {limitReached && (
        <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold ring-1 ring-inset ring-amber-600/15">
          <Info size={14} />
          {t('dashboard.courses.limit_reached', { limit })}
        </span>
      )}

      <Modal
        isDialogOpen={importOpen}
        onOpenChange={(value) => {
          if (limitReached) return
          setImportOpen(value)
          if (!value) setImportStep('select')
        }}
        minHeight="no-min"
        icon={importStep !== 'select' ? <DownloadSimple size={16} /> : undefined}
        onBack={importStep !== 'select' ? () => setImportStep('select') : undefined}
        dialogTitle={importTitles[importStep]}
        dialogDescription={importDescriptions[importStep]}
        dialogContent={importContent()}
        dialogTrigger={
          <button type="button" disabled={limitReached} className={BTN_GHOST}>
            <DownloadSimple size={16} />
            {t('dashboard.courses.home.import')}
          </button>
        }
      />

      <Modal
        isDialogOpen={open}
        onOpenChange={(value) => {
          if (limitReached) return
          onOpenChange(value)
          if (!value) setCreationStep('select')
        }}
        minHeight="no-min"
        minWidth='md'
        icon={creationStep !== 'select' ? <Plus size={16} /> : undefined}
        onBack={creationStep !== 'select' ? () => setCreationStep('select') : undefined}
        dialogTitle={creationStep === 'scratch' ? t('dashboard.courses.create_course') : t('courses.create.choose_type')}
        dialogDescription={
          creationStep === 'scratch' ? t('dashboard.courses.create_new_course') : t('courses.create.choose_type_description')
        }
        dialogContent={
          creationStep === 'scratch' ? (
            <CreateCourseModal closeModal={closeCreate} orgslug={orgslug} onCancel={() => setCreationStep('select')} />
          ) : (
            <CourseCreationTypeSelector onSelectType={onSelectCreation} currentPlan={currentPlan} />
          )
        }
      />
      {newCourseButton}

      {COURSE_BUILDER_AVAILABLE ? (
        aiOpen && (
          <CourseBuilderModal
            isOpen={aiOpen}
            onClose={() => {
              setAiOpen(false)
              onCreated()
            }}
            orgId={orgId}
            orgslug={orgslug}
            accessToken={accessToken}
          />
        )
      ) : (
        <AICourseCreationModal
          isOpen={aiOpen}
          onClose={() => {
            setAiOpen(false)
            onCreated()
          }}
          orgId={orgId}
          orgslug={orgslug}
          accessToken={accessToken}
        />
      )}
    </>
  )
}
