import { getAPIUrl } from '@services/config/config'
import {
  RequestBody,
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export async function createCourseUpdate(body: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${body.course_uuid}/updates`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteCourseUpdate(
  course_uuid: string,
  update_uuid: number,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/update/${update_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}
