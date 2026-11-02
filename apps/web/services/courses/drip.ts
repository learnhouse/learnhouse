import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'
import type { DripRule, DripSettings } from '@/lib/drip'

export interface DripSchedule {
  course_uuid: string
  settings: DripSettings
  chapters: { chapter_uuid: string; name: string; rule: DripRule }[]
}

export interface DripScheduleUpdate {
  settings: DripSettings
  chapters: { chapter_uuid: string; rule: DripRule }[]
}

export async function getDripSchedule(course_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/drip`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function updateDripSchedule(
  course_uuid: string,
  data: DripScheduleUpdate,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/drip`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  return getResponseMetadata(result)
}
