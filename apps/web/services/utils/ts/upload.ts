export type UploadProgress = {
  loaded: number
  total: number
  percentage: number
}

type UploadFormDataWithProgressOptions = {
  url: string
  method?: 'POST' | 'PUT'
  formData: FormData
  accessToken: string
  onProgress?: (_progress: UploadProgress) => void
}

function getUploadErrorMessage(data: any, fallback: string) {
  if (typeof data?.detail === 'string') {
    return data.detail
  }

  if (Array.isArray(data?.detail)) {
    return data.detail.map((e: any) => e.msg).join(', ')
  }

  return fallback
}

export function uploadFormDataWithProgress<T = any>({
  url,
  method = 'POST',
  formData,
  accessToken,
  onProgress,
}: UploadFormDataWithProgressOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.open(method, url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return
      }

      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percentage: Math.min(100, Math.round((event.loaded / event.total) * 100)),
      })
    }

    xhr.onload = () => {
      let data: any = null

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch (_error) {
        data = null
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T)
        return
      }

      reject(new Error(getUploadErrorMessage(data, xhr.statusText || 'Upload failed')))
    }

    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))

    xhr.send(formData)
  })
}
