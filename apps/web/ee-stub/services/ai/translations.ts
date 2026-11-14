// OSS stub: translating courses with Atlas requires Enterprise Edition.
// Same exports as ee/services/ai/translations.ts; every call fails with 404.

export type AtlasTranslationScope = 'course' | 'chapters' | 'activities'
export type AtlasTranslationOverwrite = 'missing_or_outdated' | 'all'

export interface AtlasTranslationRequest {
  course_uuid: string
  locales: string[]
  scope: AtlasTranslationScope
  chapter_uuids?: string[]
  activity_uuids?: string[]
  overwrite?: AtlasTranslationOverwrite
  publish?: boolean
}

export type AtlasTranslationLocaleEstimate = Record<string, unknown>
export type AtlasTranslationEstimate = { items: number; estimated_credits: number; [key: string]: unknown }
export type AtlasTranslationRun = AtlasTranslationEstimate & { job_id: string | null; state: 'running' | 'done' | 'failed' }
export type AtlasTranslationItemResult = Record<string, unknown>
export type AtlasTranslationJob = { job_id: string; state: 'running' | 'done' | 'failed'; done: number; total: number; failed: number; label: string; [key: string]: unknown }
export type AtlasSeoResult = Record<string, unknown>
export type AtlasSeoResponse = { course_uuid: string; results: AtlasSeoResult[]; credits_used: number }

function unavailable(): never {
  throw Object.assign(new Error('Not Found'), { status: 404 })
}

export async function estimateTranslation(_body: AtlasTranslationRequest, _token?: string | null): Promise<AtlasTranslationEstimate> {
  return unavailable()
}

export async function runTranslation(_body: AtlasTranslationRequest, _token?: string | null): Promise<AtlasTranslationRun> {
  return unavailable()
}

export async function getTranslationJob(_jobId: string, _token?: string | null, _courseUuid?: string): Promise<AtlasTranslationJob> {
  return unavailable()
}

export async function localizeSeo(_body: { course_uuid: string; locales: string[] }, _token?: string | null): Promise<AtlasSeoResponse> {
  return unavailable()
}

export const estimateAtlasTranslation = estimateTranslation
export const runAtlasTranslation = runTranslation
export const getAtlasTranslationJob = getTranslationJob
export const localizeCourseSeo = localizeSeo
