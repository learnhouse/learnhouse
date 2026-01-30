export interface MagicBlockContext {
  course_title: string
  course_description: string
  activity_name: string
  activity_content_summary: string
}

export interface MagicBlockMessage {
  role: 'user' | 'model'
  content: string
}

export interface MagicBlockSession {
  session_uuid: string
  iteration_count: number
  max_iterations: number
  html_content: string | null
  message_history: MagicBlockMessage[]
}

export interface MagicBlockAttrs {
  blockUuid: string
  sessionUuid: string | null
  htmlContent: string | null
  iterationCount: number
  title: string
}

export interface StreamChunk {
  type: 'chunk' | 'done' | 'error'
  content?: string
  session_uuid?: string
  message?: string
}
