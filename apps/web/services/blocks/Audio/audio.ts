import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
} from '@services/utils/ts/requests'

export type GenerateAudioSpeaker = { name: string; voice: string }

export type GenerateAudioParams = {
  activity_uuid: string
  mode: 'tts' | 'podcast'
  text: string
  voice?: string
  speakers?: GenerateAudioSpeaker[]
  style?: string
  language?: string
}

function extractDetail(data: any, fallback: string): string {
  return typeof data?.detail === 'string'
    ? data.detail
    : Array.isArray(data?.detail)
      ? data.detail.map((e: any) => e.msg).join(', ')
      : fallback
}

// Generate an audio block with AI (Gemini TTS). Returns the same shape as the
// audio upload endpoint (a BlockRead), so callers can treat it like an upload.
export async function generateAudioBlock(
  params: GenerateAudioParams,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}ai/audio/generate`,
    RequestBodyWithAuthHeader('POST', params, null, access_token)
  )

  const data = await result.json()

  if (!result.ok) {
    throw new Error(extractDetail(data, 'Audio generation failed'))
  }

  return data
}

export type GenerateScriptParams = {
  activity_uuid: string
  // 'podcast' → two-speaker dialogue; 'speak' → single-speaker detailed monologue.
  mode: 'podcast' | 'speak'
  text: string
  speakers?: GenerateAudioSpeaker[]
  style?: string
  language?: string
  // Approximate spoken length in minutes.
  minutes?: number
}

// Turn a topic/brief into a spoken script (podcast dialogue or a detailed
// monologue for "speak" mode). Returns { transcript }.
export async function generateScript(
  params: GenerateScriptParams,
  access_token: string
): Promise<{ transcript: string }> {
  const result = await fetch(
    `${getAPIUrl()}ai/audio/script`,
    RequestBodyWithAuthHeader('POST', params, null, access_token)
  )

  const data = await result.json()

  if (!result.ok) {
    throw new Error(extractDetail(data, 'Script generation failed'))
  }

  return data
}

export async function uploadNewAudioFile(
  file: any,
  activity_uuid: string,
  access_token: string
) {
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)

  const result = await fetch(
    `${getAPIUrl()}blocks/audio`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )

  const data = await result.json()

  if (!result.ok) {
    const errorMessage = typeof data?.detail === 'string'
      ? data.detail
      : Array.isArray(data?.detail)
        ? data.detail.map((e: any) => e.msg).join(', ')
        : 'Upload failed'
    throw new Error(errorMessage)
  }

  return data
}
