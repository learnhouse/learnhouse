import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function updatePassword(
  user_id: string,
  data: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}users/change_password/` + user_id,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  console.log("ARUNMOZHI "+JSON.stringify(result))
  const res = await errorHandling(result)
  return res
}
