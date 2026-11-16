// Props of the EE Atlas translation buttons (@ee/components/Atlas/Translations/
// AtlasTranslateButton, with an OSS stub that renders nothing). Kept in OSS so
// both builds type-check the same call sites.

export type AtlasTranslateScope = 'course' | 'chapters' | 'activities'

export interface AtlasTranslateButtonProps {
  courseUuid: string
  locales: string[]
  scope: AtlasTranslateScope
  chapterUuids?: string[]
  activityUuids?: string[]
  /** Button text; defaults to "Translate with Atlas". */
  label?: string
  size?: 'sm' | 'md'
  /** `icon` renders an icon-only button (outline rows). */
  variant?: 'button' | 'icon'
  disabled?: boolean
  /** Called once the job started (the Languages list then polls its progress). */
  onStarted?: (_job: { job_id: string }) => void
  /** Called when the job finished (single-activity runs wait for it). */
  onDone?: () => void
  /** Wait for the job and call onDone (activity editor). Default false. */
  waitForCompletion?: boolean
}

export interface AtlasLocalizeSeoButtonProps {
  courseUuid: string
  locale: string
  onDone?: () => void
  size?: 'sm' | 'md'
}
