import { getAPIUrl } from '@services/config/config'
import {
  RequestBody,
  RequestBodyForm,
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
} from '@services/utils/ts/requests'

export async function uploadNewImageFile(
  file: any,
  activity_uuid: string,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)

  return fetch(
    `${getAPIUrl()}blocks/image`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

export async function getImageFile(file_id: string, access_token: string) {
  // todo : add course id to url
  return fetch(
    `${getAPIUrl()}blocks/image?file_id=${file_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}
