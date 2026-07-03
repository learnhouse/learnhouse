import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
} from '@services/utils/ts/requests'

export async function uploadNewVideoFile(
  file: any,
  activity_uuid: string,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)

  const result = await fetch(
    `${getAPIUrl()}blocks/video`,
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

/**
 * Upload a video block with REAL upload progress (XHR — fetch can't report upload
 * progress). Mirrors createVideoActivityWithProgress so the block gets the same
 * accurate progress the video-activity flow has. Resolves with the created
 * BlockRead JSON.
 */
export function uploadNewVideoFileWithProgress(
  file: File,
  activity_uuid: string,
  access_token: string,
  onProgress: (_percent: number) => void
): Promise<any> {
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activity_uuid)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${getAPIUrl()}blocks/video`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Authorization', `Bearer ${access_token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          resolve({})
        }
      } else if (xhr.status === 413) {
        reject(new Error('The file is too large to upload.'))
      } else {
        let detail: string | undefined
        try {
          const body = JSON.parse(xhr.responseText)
          detail = typeof body?.detail === 'string'
            ? body.detail
            : Array.isArray(body?.detail)
              ? body.detail.map((e: any) => e.msg).join(', ')
              : undefined
        } catch {
          /* non-JSON error body */
        }
        reject(new Error(detail || `Upload failed (HTTP ${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    xhr.send(formData)
  })
}

/**
 * Fetch a fresh video block by its UUID (BlockRead). Used to read the current
 * `content.hls` transcode status — the Tiptap-stored blockObject is an
 * upload-time snapshot and never sees later HLS-ready updates.
 */
export async function getVideoBlock(block_uuid: string, access_token: string) {
  const res = await fetch(
    `${getAPIUrl()}blocks/video?block_uuid=${encodeURIComponent(block_uuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  if (!res.ok) return null
  return res.json().catch(() => null)
}

export async function getVideoFile(file_id: string, access_token: string) {
  return fetch(
    `${getAPIUrl()}blocks/video?file_id=${file_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
    .then((result) => result.json())
    .catch((error) => console.error('error', error))
}
