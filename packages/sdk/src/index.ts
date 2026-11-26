export { createClient } from './client'
export {
  ApiTokenInBrowserError,
  REFRESH_MARGIN_MS,
  SessionStore,
  refreshDelay,
  resolveSession,
  tokenExpiry,
  withSessionRetry,
} from './session'
export type { GetLearnHouseSession, LearnHouseSessionInput, ResolvedSession } from './session'
export type { ClientOptions, LearnHouseClient } from './client'

export { LearnHouseError, isLearnHouseError } from './errors'
export type { LearnHouseErrorCode } from './errors'

export { buildPath, serializeQuery } from './core/http'
export type { CoreOptions, FetchLike, HttpCore, RequestContext, ResponseContext, TypedMethod } from './core/http'
export type {
  BaseRequestOptions,
  HttpMethod,
  Operation,
  OperationBody,
  OperationParams,
  OperationResponse,
  OptionsArg,
  ParseAs,
  PathsWithMethod,
  RequestOptions,
  RetryOptions,
  UntypedRequestOptions,
} from './core/types'

export { paginate } from './core/paginate'
export type { PageContext, PaginateOptions } from './core/paginate'

export { parseWebhook, verifyWebhookSignature } from './webhooks'
export type {
  ParseWebhookInput,
  VerifyWebhookSignatureInput,
  WebhookEvent,
  WebhookHeaders,
  WebhookPayload,
} from './webhooks'

export { bindMedia, media } from './media'
export type { MediaConfig, MediaHelpers, StandaloneMediaHelpers } from './media'

export { courseProgress, findCourseRun, isActivityCompleted } from './progress'
export { TrailStore } from './trail-store'
export type { TrailStoreState } from './trail-store'
export type { CourseKey } from './progress'
export type { ReactNativeFile, UploadFile } from './core/upload'

export type { ListCoursesOptions, ListAllCoursesOptions, CourseMetaOptions, SearchCoursesOptions } from './resources/courses'
export type { ActivityRef, ResolveActivityOptions } from './resources/activities'
export type { SearchOptions, SearchPagesOptions } from './resources/search'
export type {
  LoginInput,
  MagicLinkRequestInput,
  OAuthLoginInput,
  PasswordResetInput,
  PasswordResetRequestInput,
  RefreshOptions,
  ResendVerificationInput,
  SignupInput,
  VerifyEmailInput,
} from './resources/auth'
export type { CreateEmbedSessionInput } from './resources/embed'
export type { ListMyOrgsOptions } from './resources/orgs'
export type { ListUserCoursesOptions, UpdateAvatarOptions } from './resources/users'
export type { AssignmentLangOptions, OnBehalfOptions, UploadTaskFileOptions } from './resources/assignments'
export type { CertificateLangOptions } from './resources/certificates'
export type { ListDiscussionsOptions, NewDiscussionInput, PageOptions } from './resources/communities'
export type { ListNotificationsOptions, MarkReadInput, RegisterDeviceInput } from './resources/notifications'
export type { ListPodcastsOptions } from './resources/podcasts'
export type { ListNotesOptions } from './resources/notes'
export type { InstanceInfo } from './resources/instance'
export type {
  AdminCertificate,
  AdminCourseAccess,
  AdminCourseAnalytics,
  AdminCourseEnrollment,
  AdminCourseProgress,
  AdminMagicLink,
  AdminOrgMember,
  AdminPageOptions,
  AdminProgressSummary,
  AdminResponse,
  AdminTrail,
  AdminTrailDetail,
  AdminUser,
  AdminUserExport,
  AdminUserGroup,
  AdminUserGroupMember,
  AdminUserGroupOfUser,
  AdminUserToken,
  AdminUserUpdateInput,
  MagicLinkInput,
  ProvisionUserInput,
} from './resources/admin'
export type { ActivitiesResource } from './resources/activities'
export type { AdminResource } from './resources/admin'
export type { AssignmentsResource } from './resources/assignments'
export type { AuthResource } from './resources/auth'
export type { CalendarResource } from './resources/calendar'
export type { CertificatesResource } from './resources/certificates'
export type { ChaptersResource } from './resources/chapters'
export type { CommunitiesResource, DiscussionsResource } from './resources/communities'
export type { CoursesResource } from './resources/courses'
export type { EmbedResource } from './resources/embed'
export type { InstanceResource } from './resources/instance'
export type { NotesResource } from './resources/notes'
export type { NotificationsResource } from './resources/notifications'
export type { OrgsResource } from './resources/orgs'
export type { PathsResource } from './resources/paths'
export type { PodcastsResource } from './resources/podcasts'
export type { SearchResource } from './resources/search'
export type { TrailResource } from './resources/trail'
export type { UserGroupsResource } from './resources/usergroups'
export type { UsersResource } from './resources/users'

export type * from './models'
export type { components, operations, paths } from './generated/schema'
export type {
  components as adminComponents,
  operations as adminOperations,
  paths as adminPaths,
} from './generated/admin-schema'

export { AgentStream, isAgentWaiting } from './agent/client'
export type {
  AgentOrgOptions,
  AgentResource,
  AgentStreamOptions,
  ApproveOptions,
  DenyOptions,
  ListAgentsOptions,
  ListConversationsOptions,
  ResumeOptions,
} from './agent/client'
export { AgentMessageBuilder, collectMessage, emptyAssistantMessage, pendingApprovals } from './agent/collect'
export { SSEParser, readSSE } from './agent/sse'
export type { SSEFrame } from './agent/sse'
export { AGENT_API_VERSION } from './agent/types'
export type * from './agent/types'

export { SDK_VERSION } from './version'
