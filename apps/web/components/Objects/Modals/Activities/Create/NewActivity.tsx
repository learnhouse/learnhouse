import React from 'react'
import { Browsers, PlayCircle, FileText, Backpack, MarkdownLogo, Globe, Package, Cube, VideoCamera, Lightning } from '@phosphor-icons/react'
import { SiGoogledocs, SiGooglesheets, SiGoogleslides, SiGoogleforms, SiFigma, SiNotion, SiCanvas, SiLoom, SiMiro, SiYoutube, SiSpotify, SiAirtable, SiTypeform, SiDropbox, SiTrello } from '@icons-pack/react-simple-icons'
import dynamic from 'next/dynamic'
import DynamicCanvaModal from './NewActivityModal/DynamicActivityModal'
import MarkdownModal from './NewActivityModal/MarkdownActivityModal'
import EmbedModal from './NewActivityModal/EmbedActivityModal'
import VideoModal from './NewActivityModal/VideoActivityModal'
import DocumentPdfModal from './NewActivityModal/DocumentActivityModal'
import Assignment from './NewActivityModal/AssignmentActivityModal'
import ResourceModal from './NewActivityModal/ResourceActivityModal'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTranslation } from 'react-i18next'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { getOptionalFeatureState } from '@services/features/optionalFeatures'
import type { PlanLevel } from '@services/plans/plans'

// Live sessions and SCORM authoring live in the Enterprise (ee) package (`@ee` resolves to a
// no-op stub in open-source builds); load it lazily (the card is also
// feature-gated, so it only appears when the feature is enabled).
const LiveSessionActivityModal = dynamic(() => import('@ee/components/LiveSessions/LiveSessionActivityModal'), { ssr: false })
const ScormActivityModal = dynamic(
  () => import('@ee/components/Modals/ScormActivityModal'),
  { ssr: false }
)
// Plays are Enterprise too (Pro plan and up on SaaS).
const PlayActivityModal = dynamic(() => import('@ee/components/Plays/course/PlayActivityModal'), { ssr: false })

const EMBED_SERVICES = [
  { Icon: SiGoogledocs, color: '#4285F4' },
  { Icon: SiFigma, color: '#F24E1E' },
  { Icon: SiYoutube, color: '#FF0000' },
  { Icon: SiNotion, color: '#000000' },
  { Icon: SiCanvas, color: '#00C4CC' },
  { Icon: SiGooglesheets, color: '#34A853' },
  { Icon: SiLoom, color: '#625DF5' },
  { Icon: SiMiro, color: '#050038' },
  { Icon: SiSpotify, color: '#1DB954' },
  { Icon: SiGoogleslides, color: '#FBBC04' },
  { Icon: SiAirtable, color: '#18BFFF' },
  { Icon: SiTypeform, color: '#262627' },
  { Icon: SiTrello, color: '#0052CC' },
  { Icon: SiDropbox, color: '#0061FF' },
  { Icon: SiGoogleforms, color: '#7248B9' },
]

const EmbedServicesIcon = () => (
  <div className="overflow-hidden pointer-events-none" style={{ height: 38 }}>
    <div
      className="flex items-center gap-5"
      style={{
        animation: 'embed-icons-scroll 40s linear infinite',
        width: 'max-content',
        height: 38,
      }}
    >
      {[...EMBED_SERVICES, ...EMBED_SERVICES].map((s, i) => (
        <div
          key={i}
          className="flex-shrink-0 rounded-full flex items-center justify-center bg-white nice-shadow"
          style={{ width: 30, height: 30 }}
        >
          <s.Icon size={14} color={s.color} />
        </div>
      ))}
    </div>
  </div>
)

export type ActivityTypeCard = {
  key: string
  icon: React.ElementType
  labelKey: string
  descriptionKey: string
  // Icon tile colours in the modal header.
  tone: string
  // The picker card: icon colour and background pattern.
  iconColor: string
  pattern: string
  patternSize?: string
  customIcon?: React.ComponentType
  // English fallbacks while a type's strings are not in every locale yet.
  labelDefault?: string
  descriptionDefault?: string
}

// One line each, so the picker tells teachers what they get before they click.
export const activityTypes: ActivityTypeCard[] = [
  {
    key: 'dynamic',
    icon: Browsers,
    labelKey: 'dashboard.courses.structure.activity.types.dynamic_page',
    descriptionKey: 'dashboard.courses.editor.activity_types.dynamic',
    tone: 'bg-sky-50 text-sky-600',
    iconColor: 'text-blue-400',
    pattern: `radial-gradient(circle, rgba(191,219,254,0.3) 1px, transparent 1px)`,
    patternSize: '12px 12px',
  },
  {
    key: 'video',
    icon: PlayCircle,
    labelKey: 'dashboard.courses.structure.activity.types.video',
    descriptionKey: 'dashboard.courses.editor.activity_types.video',
    tone: 'bg-violet-50 text-violet-600',
    iconColor: 'text-violet-400',
    pattern: `repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(196,181,253,0.25) 6px, rgba(196,181,253,0.25) 7px)`,
  },
  {
    key: 'documentpdf',
    icon: FileText,
    labelKey: 'dashboard.courses.structure.activity.types.document',
    descriptionKey: 'dashboard.courses.editor.activity_types.document',
    tone: 'bg-emerald-50 text-emerald-600',
    iconColor: 'text-emerald-400',
    pattern: `repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(167,243,208,0.25) 8px, rgba(167,243,208,0.25) 9px), repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(167,243,208,0.25) 8px, rgba(167,243,208,0.25) 9px)`,
  },
  {
    key: 'assignments',
    icon: Backpack,
    labelKey: 'dashboard.courses.structure.activity.types.assignments',
    descriptionKey: 'dashboard.courses.editor.activity_types.assignment',
    tone: 'bg-amber-50 text-amber-600',
    iconColor: 'text-amber-400',
    pattern: `repeating-linear-gradient(90deg, transparent, transparent 5px, rgba(253,230,138,0.25) 5px, rgba(253,230,138,0.25) 6px)`,
  },
  {
    key: 'markdown',
    icon: MarkdownLogo,
    labelKey: 'dashboard.courses.structure.activity.types.markdown',
    descriptionKey: 'dashboard.courses.editor.activity_types.markdown',
    tone: 'bg-rose-50 text-rose-600',
    iconColor: 'text-rose-400',
    pattern: `repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(253,164,175,0.2) 6px, rgba(253,164,175,0.2) 7px), repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(253,164,175,0.2) 6px, rgba(253,164,175,0.2) 7px)`,
  },
  {
    key: 'embed',
    icon: Globe,
    labelKey: 'dashboard.courses.structure.activity.types.embed',
    descriptionKey: 'dashboard.courses.editor.activity_types.embed',
    tone: 'bg-cyan-50 text-cyan-600',
    iconColor: 'text-cyan-400',
    pattern: `radial-gradient(circle, rgba(165,243,252,0.4) 1px, transparent 1px)`,
    patternSize: '12px 12px',
    customIcon: EmbedServicesIcon,
  },
  {
    key: 'resource',
    icon: Cube,
    labelKey: 'dashboard.courses.structure.activity.types.resource',
    descriptionKey: 'dashboard.courses.editor.activity_types.resource',
    tone: 'bg-indigo-50 text-indigo-600',
    iconColor: 'text-indigo-400',
    pattern: `radial-gradient(circle, rgba(199,210,254,0.4) 1px, transparent 1px)`,
    patternSize: '12px 12px',
  },
]

// Live session card, only shown when the org has live sessions enabled.
export const liveSessionActivityType: ActivityTypeCard = {
  key: 'livesession',
  icon: VideoCamera,
  labelKey: 'dashboard.courses.structure.activity.types.livesession',
  descriptionKey: 'dashboard.courses.editor.activity_types.livesession',
  tone: 'bg-red-50 text-red-600',
  iconColor: 'text-red-400',
  pattern: `repeating-linear-gradient(45deg, transparent, transparent 7px, rgba(254,202,202,0.3) 7px, rgba(254,202,202,0.3) 8px)`,
}

// SCORM authoring card, only shown when the org has the SCORM feature enabled.
export const scormActivityType: ActivityTypeCard = {
  key: 'scorm',
  icon: Package,
  labelKey: 'dashboard.courses.structure.activity.types.scorm',
  descriptionKey: 'dashboard.courses.editor.activity_types.scorm',
  tone: 'bg-neutral-100 text-neutral-700',
  iconColor: 'text-sky-400',
  pattern: `repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(186,230,253,0.3) 6px, rgba(186,230,253,0.3) 7px)`,
}

// Play card: a step-by-step play from the org's Plays, run inside the course.
// Shown when Plays are on; with a plan badge (and the upgrade prompt) when
// the plan doesn't include them.
export const playActivityType: ActivityTypeCard = {
  key: 'play',
  icon: Lightning,
  labelKey: 'play_activity.type_label',
  descriptionKey: 'play_activity.type_description',
  labelDefault: 'Play',
  descriptionDefault: 'A step-by-step play from your Plays, completed by passing it.',
  tone: 'bg-amber-50 text-amber-600',
  iconColor: 'text-amber-400',
  pattern: `radial-gradient(circle, rgba(253,230,138,0.45) 1px, transparent 1px)`,
  patternSize: '10px 10px',
}

export function getActivityType(key: string): ActivityTypeCard | undefined {
  return [...activityTypes, liveSessionActivityType, scormActivityType, playActivityType].find((a) => a.key === key)
}

function NewActivityModal({
  closeModal,
  submitActivity,
  submitFileActivity,
  submitExternalVideo,
  chapterId,
  course,
  orgslug,
  selectedView,
  setSelectedView,
  onLiveSessionCreated,
  onPlayActivityCreated,
}: any) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { showUpgrade } = useUpgradeModal()
  const scormEnabled = org?.config?.config?.resolved_features?.scorm?.enabled === true

  const liveSessionsEnabled = org?.config?.config?.resolved_features?.live_sessions?.enabled === true
  const plays = getOptionalFeatureState(org?.config?.config?.resolved_features?.playgrounds)
  const playsLocked = plays.status === 'locked'

  const visibleActivityTypes = [
    ...activityTypes,
    ...(liveSessionsEnabled ? [liveSessionActivityType] : []),
    ...(scormEnabled ? [scormActivityType] : []),
    ...(plays.status !== 'off' ? [playActivityType] : []),
  ]

  return (
    <>
      {selectedView === 'home' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
          {visibleActivityTypes.map((activity) => {
            const Icon = activity.icon
            const CustomIcon = activity.customIcon
            const locked = activity.key === 'play' && playsLocked
            return (
              <button
                key={activity.key}
                type="button"
                onClick={() =>
                  locked
                    ? showUpgrade({ source: 'new_activity_play', feature: 'playgrounds', requiredPlan: plays.upgradePlan ?? 'pro' })
                    : setSelectedView(activity.key)
                }
                className="relative flex flex-col items-center justify-center rounded-xl nice-shadow hover:scale-[1.02] transition-all duration-200 ease-in-out cursor-pointer overflow-hidden h-32 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: activity.pattern,
                    backgroundSize: activity.patternSize || 'auto',
                  }}
                />
                <div className="relative flex flex-col items-center gap-3">
                  {CustomIcon ? (
                    <CustomIcon />
                  ) : (
                    <Icon size={32} weight="duotone" className={activity.iconColor} />
                  )}
                  <span className="inline-flex items-center text-xs font-medium text-gray-500 bg-white nice-shadow rounded-full px-3 py-1">
                    {activity.labelDefault ? t(activity.labelKey, activity.labelDefault) : t(activity.labelKey)}
                    {locked && (
                      <PlanBadge currentPlan={'free' as PlanLevel} requiredPlan={(plays.upgradePlan ?? 'pro') as PlanLevel} alwaysShow />
                    )}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedView !== 'home' && (
        <div>
          {selectedView === 'dynamic' && (
            <DynamicCanvaModal
              submitActivity={submitActivity}
              chapterId={chapterId}
              course={course}
            />
          )}

          {selectedView === 'video' && (
            <VideoModal
              submitFileActivity={submitFileActivity}
              submitExternalVideo={submitExternalVideo}
              chapterId={chapterId}
              course={course}
            />
          )}

          {selectedView === 'documentpdf' && (
            <DocumentPdfModal
              submitFileActivity={submitFileActivity}
              chapterId={chapterId}
              course={course}
            />
          )}

          {selectedView === 'assignments' && (
            <Assignment
              submitActivity={submitActivity}
              chapterId={chapterId}
              course={course}
              closeModal={closeModal}
            />
          )}

          {selectedView === 'markdown' && (
            <MarkdownModal
              submitActivity={submitActivity}
              chapterId={chapterId}
              course={course}
            />
          )}

          {selectedView === 'embed' && (
            <EmbedModal
              submitActivity={submitActivity}
              chapterId={chapterId}
              course={course}
            />
          )}

          {selectedView === 'resource' && (
            <ResourceModal
              submitActivity={submitActivity}
              chapterId={chapterId}
              course={course}
              orgslug={orgslug}
            />
          )}

          {selectedView === 'livesession' && (
            <LiveSessionActivityModal
              chapterId={chapterId}
              course={course}
              onCreated={onLiveSessionCreated ?? closeModal}
            />
          )}

          {selectedView === 'play' && !playsLocked && (
            <PlayActivityModal
              course={course}
              chapterId={chapterId}
              onCreated={onPlayActivityCreated ?? closeModal}
            />
          )}

          {selectedView === 'scorm' && (
            <ScormActivityModal
              course={course}
              chapterId={chapterId}
              closeModal={closeModal}
              onImportComplete={closeModal}
            />
          )}
        </div>
      )}
    </>
  )
}

export default NewActivityModal
