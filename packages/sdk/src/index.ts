export { createClient } from './client'
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

export { bindMedia, media } from './media'
export type { MediaConfig, MediaHelpers, StandaloneMediaHelpers } from './media'

export type { ListCoursesOptions, CourseMetaOptions } from './resources/courses'
export type { SearchOptions } from './resources/search'
export type { LoginInput, RefreshOptions } from './resources/auth'

export type {
  Activity,
  AuthMe,
  AuthTokens,
  Chapter,
  Course,
  CourseMeta,
  LoginMfaChallenge,
  LoginResult,
  LoginSuccess,
  Organization,
  PublicUserProfile,
  SearchResult,
  Trail,
  TrailRun,
  TrailStep,
  User,
  UserSession,
} from './models'
export type { components, operations, paths } from './generated/schema'

export { SDK_VERSION } from './version'
