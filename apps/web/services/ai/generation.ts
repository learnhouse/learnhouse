import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { getAIImageMediaDirectory } from '@services/media/media'

// ---------------------------------------------------------------------------
// AI generation clients (image / quiz / assignment) + durable history.
// Non-streaming, structured endpoints — the backend guarantees schema-valid
// output so the UI can preview/insert directly. See src/routers/ai/{images,
// quiz,assignment_gen}.py.
// ---------------------------------------------------------------------------

async function postJSON(path: string, data: any, access_token: string) {
  const res = await fetch(
    `${getAPIUrl()}${path}`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const json = await res.json().catch(() => ({}))
  return { success: res.status === 200, status: res.status, data: json }
}

async function getJSON(path: string, access_token: string) {
  const res = await fetch(`${getAPIUrl()}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${access_token}` },
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ([]))
  return { success: res.status === 200, status: res.status, data: json }
}

async function del(path: string, access_token: string) {
  const res = await fetch(`${getAPIUrl()}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${access_token}` },
    cache: 'no-store',
  })
  return { success: res.status === 200, status: res.status }
}

// --- Types ---

export interface AIImageResult {
  ai_generation_uuid: string
  session_uuid: string
  file_id: string
  media_url: string // relative content path; use getAIImageMediaDirectory for absolute
  prompt: string
}

export interface AIImageHistoryItem {
  ai_generation_uuid: string
  session_uuid?: string
  prompt: string
  file_id: string
  media_url: string
  creation_date?: string
}

// --- Image generation ---

export async function generateAIImage(
  params: {
    org_id: number
    prompt: string
    session_uuid?: string
    // Preferred way to refine: the file_id of a prior AI image in this org.
    source_file_id?: string
    source_image_base64?: string
    course_id?: number
    activity_id?: number
  },
  access_token: string
) {
  return postJSON('ai/images/generate', params, access_token)
}

export async function fetchAIImageHistory(
  org_id: number,
  access_token: string,
  limit = 30
) {
  return getJSON(`ai/images/history?org_id=${org_id}&limit=${limit}`, access_token)
}

export async function deleteAIImageHistory(uuid: string, access_token: string) {
  return del(`ai/images/history/${uuid}`, access_token)
}

/** Build the absolute URL for a generated image from its file_id. */
export function aiImageUrl(orgUUID: string, fileId: string) {
  return getAIImageMediaDirectory(orgUUID, fileId)
}

// --- Quiz generation ---

export async function generateAIQuiz(
  params: {
    org_id: number
    prompt: string
    activity_uuid?: string
    session_uuid?: string
    num_questions?: number
    difficulty?: 'easy' | 'medium' | 'hard'
  },
  access_token: string
) {
  return postJSON('ai/quiz/generate', params, access_token)
}

export async function fetchAIQuizHistory(org_id: number, access_token: string, limit = 30) {
  return getJSON(`ai/quiz/history?org_id=${org_id}&limit=${limit}`, access_token)
}

export async function deleteAIQuizHistory(uuid: string, access_token: string) {
  return del(`ai/quiz/history/${uuid}`, access_token)
}

// --- Assignment generation ---

export async function generateAIAssignment(
  params: {
    org_id: number
    course_uuid: string
    prompt: string
    session_uuid?: string
    num_tasks?: number
    allowed_task_types?: string[]
  },
  access_token: string
) {
  return postJSON('ai/assignments/generate', params, access_token)
}

export async function fetchAIAssignmentHistory(org_id: number, access_token: string, limit = 30) {
  return getJSON(`ai/assignments/history?org_id=${org_id}&limit=${limit}`, access_token)
}

export async function deleteAIAssignmentHistory(uuid: string, access_token: string) {
  return del(`ai/assignments/history/${uuid}`, access_token)
}
