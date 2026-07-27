import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  uploadFormWithProgress,
} from '@services/utils/ts/requests'

export async function uploadNewImageFile(
  file: any,
  activity_uuid: string,
  access_token: string,
  onProgress?: (_percent: number) => void
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)

  return uploadFormWithProgress(
    `${getAPIUrl()}blocks/image`,
    formData,
    access_token,
    onProgress
  )
}

export async function getImageFile(file_id: string, access_token: string) {
  // todo : add course id to url
  const result = await fetch(
    `${getAPIUrl()}blocks/image?file_id=${file_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )

  const data = await result.json()

  if (!result.ok) {
    const errorMessage = typeof data?.detail === 'string'
      ? data.detail
      : Array.isArray(data?.detail)
        ? data.detail.map((e: any) => e.msg).join(', ')
        : 'Failed to retrieve image'
    throw new Error(errorMessage)
  }

  return data
}

