import { getAPIUrl } from '@services/config/config'
import { RequestBodyFormWithAuthHeader } from '@services/utils/ts/requests'

export async function uploadSqliteDb(
  file: File,
  activity_uuid: string,
  block_id: string,
  org_uuid: string,
  course_uuid: string,
  access_token: string
) {
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)
  formData.append('block_id', block_id)
  formData.append('org_uuid', org_uuid)
  formData.append('course_uuid', course_uuid)

  const result = await fetch(
    `${getAPIUrl()}code/upload-sqlite`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )

  const data = await result.json()

  if (!result.ok) {
    const errorMessage =
      typeof data?.detail === 'string'
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((e: any) => e.msg).join(', ')
          : 'Upload failed'
    throw new Error(errorMessage)
  }

  return data
}
