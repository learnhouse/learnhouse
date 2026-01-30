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

// Streaming response types
export interface StreamStartData {
  aichat_uuid: string
}

export interface StreamDoneData {
  aichat_uuid: string
  activity_uuid: string
}

export interface StreamFollowUpsData {
  follow_up_suggestions: string[]
}

interface StreamStartEvent {
  type: 'start'
  aichat_uuid: string
}

interface StreamChunkEvent {
  type: 'chunk'
  content: string
}

interface StreamDoneEvent {
  type: 'done'
  aichat_uuid: string
  activity_uuid: string
}

interface StreamFollowUpsEvent {
  type: 'follow_ups'
  follow_up_suggestions: string[]
}

interface StreamErrorEvent {
  type: 'error'
  message: string
}

type StreamEvent = StreamStartEvent | StreamChunkEvent | StreamDoneEvent | StreamFollowUpsEvent | StreamErrorEvent

export interface StreamCallbacks {
  onStart?: (data: StreamStartData) => void
  onChunk: (chunk: string) => void
  onComplete: (data: StreamDoneData) => void
  onFollowUps?: (data: StreamFollowUpsData) => void
  onError: (error: string) => void
}

/**
 * Process SSE stream from response
 */
async function processStream(
  response: Response,
  callbacks: StreamCallbacks
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('Failed to get response reader')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE events (data: {...}\n\n)
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || '' // Keep incomplete data in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6) // Remove 'data: ' prefix
            const event: StreamEvent = JSON.parse(jsonStr)

            switch (event.type) {
              case 'start':
                callbacks.onStart?.({ aichat_uuid: event.aichat_uuid })
                break
              case 'chunk':
                callbacks.onChunk(event.content)
                break
              case 'done':
                callbacks.onComplete({
                  aichat_uuid: event.aichat_uuid,
                  activity_uuid: event.activity_uuid,
                })
                break
              case 'follow_ups':
                callbacks.onFollowUps?.({ follow_up_suggestions: event.follow_up_suggestions })
                break
              case 'error':
                callbacks.onError(event.message)
                break
            }
          } catch {
            // Failed to parse SSE event, skip
          }
        }
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Stream processing failed')
  } finally {
    reader.releaseLock()
  }
}

/**
 * Start a new AI chat session with streaming response
 */
export async function startActivityAIChatSessionStream(
  message: string,
  activity_uuid: string,
  access_token: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const data = {
    message,
    activity_uuid,
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/stream/start/activity_chat_session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to start chat session')
  }
}

/**
 * Send a message to existing AI chat session with streaming response
 */
export async function sendActivityAIChatMessageStream(
  message: string,
  aichat_uuid: string,
  activity_uuid: string,
  access_token: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const data = {
    aichat_uuid,
    message,
    activity_uuid,
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/stream/send/activity_chat_message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to send message')
  }
}
