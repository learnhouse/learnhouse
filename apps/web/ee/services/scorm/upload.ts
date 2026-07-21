export interface ScormUploadProgress {
  loadedBytes: number
  totalBytes: number
  percent: number
}

const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Upload a SCORM package with real upload progress.
 *
 * Uses XMLHttpRequest because fetch() cannot report request-body upload
 * progress; large packages (hundreds of MB) otherwise sit on an indeterminate
 * spinner for minutes. Resolves with the parsed JSON analysis response and
 * rejects with the backend `detail` message on failure.
 */
export function uploadScormPackage<T = any>(
  url: string,
  file: File,
  accessToken: string,
  onProgress?: (_progress: ScormUploadProgress) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    xhr.responseType = 'json'

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return
      const totalBytes = event.lengthComputable ? event.total : file.size
      const loadedBytes = Math.min(event.loaded, totalBytes)
      onProgress({
        loadedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
      })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as T)
      } else {
        const detail = xhr.response?.detail
        reject(new Error(detail || `Upload failed (HTTP ${xhr.status})`))
      }
    }
    xhr.onerror = () =>
      reject(new Error('Upload failed. Please check your connection and try again.'))
    xhr.ontimeout = () =>
      reject(new Error('Upload timed out. Please try again on a faster connection.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))

    const formData = new FormData()
    formData.append('scorm_file', file)
    xhr.send(formData)
  })
}

export function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}
