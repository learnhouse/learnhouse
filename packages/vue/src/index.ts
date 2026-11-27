export { LearnHouseActivity } from './LearnHouseActivity'
export { LearnHouseProvider, provideLearnHouse, useLearnHouseClient } from './provider'
export type { LearnHouseContext, LearnHouseOptions, LinkTarget } from './provider'
export { useActivity, useCourseProgress, useTrail } from './composables'
export type { UseActivityOptions, UseActivityReturn, UseCourseProgressReturn, UseTrailReturn } from './composables'
export type { CourseKey, CourseProgress, Trail } from '@learnhouse/sdk'
export type {
  ActivityDocument,
  LearnHouseActivityData,
  LearnHouseEvent,
  LearnHouseTheme,
  ThemeMode,
} from '@learnhouse/react'
export type { LearnHouseLinkClickDetail } from '@learnhouse/react/element'
export type { GetLearnHouseSession, LearnHouseSessionInput } from '@learnhouse/sdk'
export { AgentChat } from './AgentChat'
export { useAgentConversation } from './agent'
export type { AgentConversationStatus, UseAgentConversationOptions, UseAgentConversationReturn } from './agent'
export type { AgentEvent, Approval, Citation, Conversation, Message, View, ViewComponent } from '@learnhouse/sdk'
export { VERSION } from './version'
