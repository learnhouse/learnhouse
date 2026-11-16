import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getOrgCourses(
  org_slug: string,
  next: any,
  access_token?: any,
  include_unpublished: boolean = false,
  // `lang`: the learner's content language list (localized names);
  // `language`: only courses available in that locale.
  i18n?: { lang?: string; language?: string }
) {
  const qs = new URLSearchParams()
  if (include_unpublished) qs.set('include_unpublished', 'true')
  if (i18n?.lang) qs.set('lang', i18n.lang)
  if (i18n?.language) qs.set('language', i18n.language)
  const url = `${getAPIUrl()}courses/org_slug/${org_slug}/page/1/limit/100${qs.toString() ? `?${qs.toString()}` : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

// The list endpoint caps a page at 100 rows, so a dashboard that asked for
// "limit 500" silently lost everything past the 100th course. Walk the pages
// until a short one comes back instead.
const ORG_COURSES_PAGE_SIZE = 100
const ORG_COURSES_MAX_PAGES = 50

export async function getAllOrgCourses(
  org_slug: string,
  access_token?: any,
  include_unpublished: boolean = true
) {
  const seen = new Set<string>()
  const all: any[] = []
  for (let page = 1; page <= ORG_COURSES_MAX_PAGES; page++) {
    const url = `${getAPIUrl()}courses/org_slug/${org_slug}/page/${page}/limit/${ORG_COURSES_PAGE_SIZE}${include_unpublished ? '?include_unpublished=true' : ''}`
    const res = await fetch(url, RequestBodyWithAuthHeader('GET', null, null, access_token))
    if (!res.ok) throw new Error('Failed to fetch courses')
    const batch = await res.json()
    if (!Array.isArray(batch)) break
    for (const course of batch) {
      // A course created mid-walk shifts later pages by one; skip the repeat.
      if (seen.has(course.course_uuid)) continue
      seen.add(course.course_uuid)
      all.push(course)
    }
    if (batch.length < ORG_COURSES_PAGE_SIZE) break
  }
  return all
}

export async function searchOrgCourses(
  org_slug: string,
  query: string,
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/org_slug/${org_slug}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseMetadata(
  course_uuid: string,
  next: any,
  access_token: string | null | undefined,
  options?: { slim?: boolean; withUnpublishedActivities?: boolean; lang?: string }
) {
  const searchParams = new URLSearchParams()
  if (options?.slim) searchParams.set('slim', 'true')
  // Learner content language list (`fr,en`): localized texts when published.
  if (options?.lang) searchParams.set('lang', options.lang)
  if (options?.withUnpublishedActivities !== undefined) {
    searchParams.set('with_unpublished_activities', String(options.withUnpublishedActivities))
  }
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const result = await fetch(
    `${getAPIUrl()}courses/course_${course_uuid}/meta${qs}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourse(course_uuid: any, data: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourse(course_uuid: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseById(course_id: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/id/${course_id}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourseThumbnail(course_uuid: any, formData: FormData, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createNewCourse(
  org_id: string,
  course_body: any,
  thumbnail: any,
  access_token: any
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('name', course_body.name || '')
  formData.append('description', course_body.description || '')
  formData.append('public', course_body.visibility)
  formData.append('learnings', course_body.learnings || '')
  formData.append('tags', course_body.tags || '')
  formData.append('about', course_body.description || '')

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const result = await fetch(
    `${getAPIUrl()}courses/?org_id=${org_id}`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteCourseFromBackend(course_uuid: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function cloneCourse(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/clone`,
    RequestBodyWithAuthHeader('POST', null, null, access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getCourseContributors(course_uuid: string, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors`,
    RequestBodyWithAuthHeader('GET', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function editContributor(course_uuid: string, contributor_id: string, authorship: any, authorship_status: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors/${contributor_id}?authorship=${authorship}&authorship_status=${authorship_status}`,
    RequestBodyWithAuthHeader('PUT', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function applyForContributor(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/apply-contributor`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkAddContributors(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-add-contributors`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkRemoveContributors(course_uuid: string, data: any, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-remove-contributors`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseRights(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/rights`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}