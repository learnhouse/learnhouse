import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes certification-related API calls
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getCourseCertifications(
  course_uuid: string,
  next: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}certifications/course/${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createCertification(
  course_id: number,
  config: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}certifications/`,
    RequestBodyWithAuthHeader('POST', { course_id, config }, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCertification(
  certification_uuid: string,
  config: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}certifications/${certification_uuid}`,
    RequestBodyWithAuthHeader('PUT', { config }, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteCertification(
  certification_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}certifications/${certification_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
} 