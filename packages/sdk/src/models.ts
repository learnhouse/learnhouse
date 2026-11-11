// Friendly names for the generated schema components the resources return.
// Everything here is an alias of src/generated/schema.ts, except the auth
// response shapes noted below.
import type { components } from './generated/schema'

type Schemas = components['schemas']

export type Organization = Schemas['OrganizationRead']
export type Course = Schemas['CourseRead']
/** A course with its chapters and their activities (`GET /courses/{uuid}/meta`). */
export type CourseMeta = Schemas['FullCourseRead']
export type Chapter = Schemas['ChapterRead']
export type Activity = Schemas['ActivityRead']
export type Trail = Schemas['TrailRead']
export type TrailRun = Schemas['TrailRunRead']
export type TrailStep = Schemas['TrailStep']
export type SearchResult = Schemas['SearchResult']
export type User = Schemas['UserRead']
/** What other users may see of a user. */
export type PublicUserProfile = Schemas['UserReadPublic']
export type UserSession = Schemas['UserSession']
export type AuthMe = Schemas['AuthMeResponse']

// The API declares no response_model for /auth/login, /auth/login/mfa and
// /auth/refresh, so the generated types say `unknown`. These mirror the dicts
// apps/api/src/routers/auth.py returns.

export interface AuthTokens {
  access_token: string
  refresh_token: string
  /** Access-token expiry as a Unix timestamp in milliseconds. */
  expiry: number | null
}

export interface LoginSuccess {
  mfa_required?: false
  user: User
  tokens: AuthTokens
}

export interface LoginMfaChallenge {
  mfa_required: true
  /** Pass to `auth.loginMfa()` together with the user's code. */
  mfa_token: string
}

export type LoginResult = LoginSuccess | LoginMfaChallenge
