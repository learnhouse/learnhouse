import { getAPIUrl } from '@services/config/config'
import {
  RequestBody,
  errorHandling,
  RequestBodyForm,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function updateOrganization(org_id: string, data: any) {
  const result: any = await fetch(
    `${getAPIUrl()}orgs/` + org_id,
    RequestBody('PUT', data, null)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadOrganizationLogo(org_id: string, logo_file: any) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('logo_file', logo_file)
  const result: any = await fetch(
    `${getAPIUrl()}orgs/` + org_id + '/logo',
    RequestBodyForm('PUT', formData, null)
  )
  const res = await errorHandling(result)
  return res
}
