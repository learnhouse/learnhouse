import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
} from '@services/utils/ts/requests'
import { uploadFormDataWithProgress } from '@services/utils/ts/upload'
import type { UploadProgress } from '@services/utils/ts/upload'

export async function uploadNewVideoFile(
  file: any,
  activity_uuid: string,
  access_token: string,
  onProgress?: (_progress: UploadProgress) => void
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)

  return uploadFormDataWithProgress({
    url: `${getAPIUrl()}blocks/video`,
    method: 'POST',
    formData,
    accessToken: access_token,
    onProgress,
  })
}

export async function getVideoFile(file_id: string, access_token: string) {
  return fetch(
    `${getAPIUrl()}blocks/video?file_id=${file_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.error('error', error))
}
