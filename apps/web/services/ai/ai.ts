import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

export async function startActivityAIChatSession(
  message: string,
  access_token: string,
  activity_uuid?: string
) {
  const data = {
    message,
    activity_uuid,
  }
  const result = await fetch(
    `${getAPIUrl()}ai/start/activity_chat_session`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const json = await result.json()
  if (result.status === 200) {
    return {
      success: true,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  } else {
    return {
      success: false,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  }
}

export async function sendActivityAIChatMessage(
  message: string,
  aichat_uuid: string,
  activity_uuid: string,
  access_token: string
) {
  const data = {
    aichat_uuid,
    message,
    activity_uuid,
  }
  const result = await fetch(
    `${getAPIUrl()}ai/send/activity_chat_message`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )

  const json = await result.json()
  if (result.status === 200) {
    return {
      success: true,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  } else {
    return {
      success: false,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  }
}
