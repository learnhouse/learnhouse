import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

export async function submitQuizBlock(activity_id: string, data: any,access_token:string) {
  const result: any = await fetch(
    `${getAPIUrl()}blocks/quiz/${activity_id}"`,
    RequestBodyWithAuthHeader('POST', data, null,access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
  return result
}
