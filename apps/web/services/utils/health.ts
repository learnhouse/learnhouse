import { getAPIUrl } from '@services/config/config'
import {
  RequestBody,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export async function checkHealth() {
  try {
    const result = await fetch(
      `${getAPIUrl()}health`,
      RequestBody('GET', null, null)
    )
    
    if (!result.ok) {
      return {
        success: false,
        status: result.status,
        HTTPmessage: result.statusText,
        data: null
      }
    }
    
    const res = await getResponseMetadata(result)
    return res
  } catch (error) {
    return {
      success: false,
      status: 503,
      HTTPmessage: 'Service unavailable',
      data: null
    }
  }
}
