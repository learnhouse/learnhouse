import { getAPIUrl } from '@services/config/config'

interface BoardsPlaygroundContext {
  board_name: string
  board_description: string
}

interface StreamChunk {
  type: 'chunk' | 'done' | 'error'
  content?: string
  session_uuid?: string
  message?: string
}

export async function startBoardsPlaygroundSession(
  boardUuid: string,
  blockUuid: string,
  prompt: string,
  context: BoardsPlaygroundContext,
  accessToken: string,
  onChunk: (chunk: string) => void,
  onComplete: (sessionUuid: string) => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    const response = await fetch(`${getAPIUrl()}boards/playground/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        board_uuid: boardUuid,
        block_uuid: blockUuid,
        prompt,
        context,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `HTTP error ${response.status}`)
    }

    await processStream(response, onChunk, onComplete, onError)
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Unknown error occurred')
  }
}

export async function iterateBoardsPlayground(
  sessionUuid: string,
  boardUuid: string,
  blockUuid: string,
  message: string,
  accessToken: string,
  onChunk: (chunk: string) => void,
  onComplete: (sessionUuid: string) => void,
  onError: (error: string) => void,
  currentHtml?: string | null
): Promise<void> {
  try {
    const response = await fetch(`${getAPIUrl()}boards/playground/iterate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_uuid: sessionUuid,
        board_uuid: boardUuid,
        block_uuid: blockUuid,
        message,
        current_html: currentHtml || undefined,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `HTTP error ${response.status}`)
    }

    await processStream(response, onChunk, onComplete, onError)
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Unknown error occurred')
  }
}

async function processStream(
  response: Response,
  onChunk: (chunk: string) => void,
  onComplete: (sessionUuid: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    onError('No response body')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = ''

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6)
          try {
            const event: StreamChunk = JSON.parse(jsonStr)

            if (event.type === 'chunk' && event.content) {
              onChunk(event.content)
            } else if (event.type === 'done' && event.session_uuid) {
              onComplete(event.session_uuid)
            } else if (event.type === 'error' && event.message) {
              onError(event.message)
            }
          } catch {
            if (i === lines.length - 1) {
              buffer = line
            }
          }
        } else if (line.trim() !== '') {
          if (i === lines.length - 1) {
            buffer = line
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
