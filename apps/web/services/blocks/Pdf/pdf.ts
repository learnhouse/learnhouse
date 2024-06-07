import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
} from '@services/utils/ts/requests'

export async function uploadNewPDFFile(
  file: any,
  activity_uuid: string,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)

  return fetch(
    `${getAPIUrl()}blocks/pdf`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

export async function getPDFFile(file_id: string, access_token: string) {
  // todo : add course id to url
  return fetch(
    `${getAPIUrl()}blocks/pdf?file_id=${file_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}
