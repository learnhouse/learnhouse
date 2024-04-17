import { getAPIUrl } from '@services/config/config'
import { RequestBody, getResponseMetadata } from '@services/utils/ts/requests'

export async function createCourseUpdate(body: any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${body.course_uuid}/updates`,
    RequestBody('POST', body, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteCourseUpdate(
  course_uuid: string,
  update_uuid: number
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/update/${update_uuid}`,
    RequestBody('DELETE', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}
