/*
 Shared building blocks for the Experiences family (see EXPERIENCES_SPEC.md,
 "Shared module contract"). Node files (<Name>.ts) should import attr helpers
 from './shared/attrs' directly so they stay free of React.
*/
export { ExperienceFrame, type ExperienceFrameProps } from './ExperienceFrame'
export { ExperienceFooter, type ExperienceFooterProps } from './ExperienceFooter'
export { Celebrate, type CelebrateProps } from './Celebrate'
export { Stars, type StarsProps } from './Stars'
export { InlineText, type InlineTextProps, type InlineTextHandle } from './InlineText'
export {
  AddGhost,
  RemoveX,
  CorrectMark,
  SettingsGear,
  SettingsToggle,
  AnswerKeyHint,
  EDIT_OBJECT,
  type AddGhostProps,
  type RemoveXProps,
  type CorrectMarkProps,
  type SettingsGearProps,
} from './authoring'
export {
  useLiveAttrs,
  readLiveAttrs,
  useExperienceMemory,
  useExperienceEditable,
  useEnsureBlockId,
  usePrefersReducedMotion,
  activityUuidOf,
  experienceStorageKey,
  EXPERIENCE_STORAGE_PREFIX,
  type CommitPatch,
  type ExperienceMemory,
} from './hooks'
export { newId, newBlockId, shuffle, starsFromRatio, normalizeAnswer, answersMatch, clamp, asArray, asString, asNumber } from './utils'
export { jsonAttr, blockIdAttr } from './attrs'
export { buzz } from './feel'
export type { BlockTone } from '../../../Blocks/ui/BlockChrome'
