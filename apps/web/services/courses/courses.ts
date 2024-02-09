import { getAPIUrl } from '@services/config/config'
import {
  RequestBody,
  RequestBodyForm,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getOrgCourses(org_id: number, next: any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/org_slug/${org_id}/page/1/limit/10`,
    RequestBody('GET', null, next)
  )
  const res = await errorHandling(result)
  return res
}

export async function getOrgCoursesWithAuthHeader(
  org_id: number,
  next: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/org_slug/${org_id}/page/1/limit/10`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseMetadataWithAuthHeader(
  course_uuid: any,
  next: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}courses/course_${course_uuid}/meta`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourse(course_uuid: any, data: any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBody('PUT', data, null)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourse(course_uuid: string, next: any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBody('GET', null, next)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourseThumbnail(course_uuid: any, thumbnail: any) {
  const formData = new FormData()
  formData.append('thumbnail', thumbnail)
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/thumbnail`,
    RequestBodyForm('PUT', formData, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createNewCourse(
  org_id: string,
  course_body: any,
  thumbnail: any
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('name', course_body.name)
  formData.append('description', course_body.description)
  formData.append('public', course_body.visibility)
  formData.append('learnings', course_body.tags)
  formData.append('tags', course_body.tags)
  formData.append('about', course_body.description)

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const result = await fetch(
    `${getAPIUrl()}courses/?org_id=${org_id}`,
    RequestBodyForm('POST', formData, null)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteCourseFromBackend(course_uuid: any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBody('DELETE', null, null)
  )
  const res = await errorHandling(result)
  return res
}
