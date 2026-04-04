import React from 'react'
import { Browsers, PlayCircle, FileText, Backpack, MarkdownLogo, Globe } from '@phosphor-icons/react'
import { SiGoogledocs, SiGooglesheets, SiGoogleslides, SiGoogleforms, SiFigma, SiNotion, SiCanvas, SiLoom, SiMiro, SiYoutube, SiSpotify, SiAirtable, SiTypeform, SiDropbox, SiTrello } from '@icons-pack/react-simple-icons'
import DynamicCanvaModal from './NewActivityModal/DynamicActivityModal'
import MarkdownModal from './NewActivityModal/MarkdownActivityModal'
import EmbedModal from './NewActivityModal/EmbedActivityModal'
import VideoModal from './NewActivityModal/VideoActivityModal'
import DocumentPdfModal from './NewActivityModal/DocumentActivityModal'
import Assignment from './NewActivityModal/AssignmentActivityModal'
import { useTranslation } from 'react-i18next'

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

export const activityTypes = [
  {
    key: 'dynamic',
    icon: Browsers,
    labelKey: 'dashboard.courses.structure.activity.types.dynamic_page',
    color: {
      icon: 'text-blue-400',
    },
    pattern: `radial-gradient(circle, rgba(191,219,254,0.3) 1px, transparent 1px)`,
    patternSize: '12px 12px',
  },
  {
    key: 'video',
    icon: PlayCircle,
    labelKey: 'dashboard.courses.structure.activity.types.video',
    color: {
      icon: 'text-violet-400',
    },
    pattern: `repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(196,181,253,0.25) 6px, rgba(196,181,253,0.25) 7px)`,
  },
  {
    key: 'documentpdf',
    icon: FileText,
    labelKey: 'dashboard.courses.structure.activity.types.document',
    color: {
      icon: 'text-emerald-400',
    },
    pattern: `repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(167,243,208,0.25) 8px, rgba(167,243,208,0.25) 9px), repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(167,243,208,0.25) 8px, rgba(167,243,208,0.25) 9px)`,
  },
  {
    key: 'assignments',
    icon: Backpack,
    labelKey: 'dashboard.courses.structure.activity.types.assignments',
    color: {
      icon: 'text-amber-400',
    },
    pattern: `repeating-linear-gradient(90deg, transparent, transparent 5px, rgba(253,230,138,0.25) 5px, rgba(253,230,138,0.25) 6px)`,
  },
  {
    key: 'markdown',
    icon: MarkdownLogo,
    labelKey: 'dashboard.courses.structure.activity.types.markdown',
    color: {
      icon: 'text-rose-400',
    },
    pattern: `repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(253,164,175,0.2) 6px, rgba(253,164,175,0.2) 7px), repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(253,164,175,0.2) 6px, rgba(253,164,175,0.2) 7px)`,
  },
  {
    key: 'embed',
    icon: Globe,
    customIcon: EmbedServicesIcon,
    labelKey: 'dashboard.courses.structure.activity.types.embed',
    color: {
      icon: 'text-cyan-400',
    },
    pattern: `radial-gradient(circle, rgba(165,243,252,0.4) 1px, transparent 1px)`,
    patternSize: '12px 12px',
  },
]

function NewActivityModal({
  closeModal,
  submitActivity,
  submitFileActivity,
  submitExternalVideo,
  chapterId,
  course,
  selectedView,
  setSelectedView,
}: any) {
  const { t } = useTranslation()

  return (
    <>
      {selectedView === 'home' && (
        <div className="grid grid-cols-3 gap-3 p-5 w-full">
          {activityTypes.map((activity) => {
            const Icon = activity.icon
            const CustomIcon = (activity as any).customIcon
            return (
              <div
                key={activity.key}
                onClick={() => setSelectedView(activity.key)}
                className="relative flex flex-col items-center justify-center rounded-xl nice-shadow hover:scale-[1.02] transition-all duration-200 ease-in-out cursor-pointer overflow-hidden h-32"
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
                    <Icon
                      size={32}
                      weight="duotone"
                      className={activity.color.icon}
                    />
                  )}
                  <span className="text-xs font-medium text-gray-500 bg-white nice-shadow rounded-full px-3 py-1">
                    {t(activity.labelKey)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedView !== 'home' && (
        <div className="p-5">
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
        </div>
      )}
    </>
  )
}

export default NewActivityModal
