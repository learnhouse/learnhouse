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
    const errorMessage = typeof data?.detail === 'string'
      ? data.detail
      : Array.isArray(data?.detail)
        ? data.detail.map((e: any) => e.msg).join(', ')
        : 'Audio generation failed'
    throw new Error(errorMessage)
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
