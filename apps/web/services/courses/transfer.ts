import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/**
 * Course Transfer Service
 * Handles export and import of courses as ZIP packages
 */

// Types for import/export operations
export interface ImportCourseInfo {
  course_uuid: string
  name: string
  description: string | null
  chapters_count: number
  activities_count: number
  has_thumbnail: boolean
}

export interface ImportAnalysisResponse {
  temp_id: string
  version: string
  courses: ImportCourseInfo[]
}

export interface ImportOptions {
  course_uuids: string[]
  name_prefix?: string | null
  set_private: boolean
  set_unpublished: boolean
}

export interface ImportCourseResult {
  original_uuid: string
  new_uuid: string
  name: string
  success: boolean
  error?: string | null
}

export interface ImportResult {
  total_courses: number
  successful: number
  failed: number
  courses: ImportCourseResult[]
}

export type ExportStatus =
  | 'preparing'
  | 'collecting_metadata'
  | 'packaging_chapters'
  | 'packaging_activities'
  | 'packaging_files'
  | 'compressing'
  | 'downloading'
  | 'finalizing'
  | 'complete'
  | 'error'

export type ExportProgressCallback = (progress: number, status: ExportStatus) => void

/**
 * Get export status based on progress percentage
 */
function getExportStatus(progress: number, isDownloading: boolean): ExportStatus {
  if (isDownloading) {
    if (progress >= 95) return 'finalizing'
    return 'downloading'
  }
  if (progress < 10) return 'preparing'
  if (progress < 20) return 'collecting_metadata'
  if (progress < 35) return 'packaging_chapters'
  if (progress < 50) return 'packaging_activities'
  if (progress < 65) return 'packaging_files'
  if (progress < 80) return 'compressing'
  return 'downloading'
}

/**
 * Export a single course as a ZIP file with progress tracking
 */
export async function exportCourse(
  course_uuid: string,
  access_token: string | null | undefined,
  onProgress?: ExportProgressCallback
): Promise<Blob> {
  // Simulate detailed progress stages during server processing
  onProgress?.(5, 'preparing')

  const progressInterval = simulateServerProgress(onProgress, 5, 50, 2000)

  const response = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/export`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  )

  clearInterval(progressInterval)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Export failed' }))
    throw new Error(error.detail || 'Failed to export course')
  }

  onProgress?.(55, 'downloading')

  // Read the response with progress if possible
  const contentLength = response.headers.get('content-length')
  if (contentLength && response.body) {
    const total = parseInt(contentLength, 10)
    let loaded = 0
    const reader = response.body.getReader()
    const chunks: BlobPart[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as BlobPart)
      loaded += value.length
      const progress = 55 + Math.round((loaded / total) * 40) // 55-95%
      onProgress?.(progress, getExportStatus(progress, true))
    }

    onProgress?.(96, 'finalizing')
    const blob = new Blob(chunks)
    onProgress?.(100, 'complete')
    return blob
  }

  onProgress?.(90, 'downloading')
  const blob = await response.blob()
  onProgress?.(96, 'finalizing')
  onProgress?.(100, 'complete')
  return blob
}

/**
 * Simulate progress during server-side processing
 */
function simulateServerProgress(
  onProgress: ExportProgressCallback | undefined,
  startProgress: number,
  endProgress: number,
  duration: number
): NodeJS.Timeout {
  const steps = 10
  const increment = (endProgress - startProgress) / steps
  const interval = duration / steps
  let currentProgress = startProgress

  return setInterval(() => {
    currentProgress = Math.min(currentProgress + increment, endProgress)
    const status = getExportStatus(currentProgress, false)
    onProgress?.(Math.round(currentProgress), status)
  }, interval)
}

/**
 * Export multiple courses as a single ZIP file with progress tracking
 */
export async function exportCoursesBatch(
  course_uuids: string[],
  access_token: string | null | undefined,
  onProgress?: ExportProgressCallback
): Promise<Blob> {
  // Simulate detailed progress stages during server processing
  // Longer duration for batch exports
  onProgress?.(5, 'preparing')

  const estimatedDuration = Math.min(course_uuids.length * 1500, 10000) // 1.5s per course, max 10s
  const progressInterval = simulateServerProgress(onProgress, 5, 50, estimatedDuration)

  const response = await fetch(
    `${getAPIUrl()}courses/export/batch`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ course_uuids }),
    }
  )

  clearInterval(progressInterval)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Export failed' }))
    throw new Error(error.detail || 'Failed to export courses')
  }

  onProgress?.(55, 'downloading')

  // Read the response with progress if possible
  const contentLength = response.headers.get('content-length')
  if (contentLength && response.body) {
    const total = parseInt(contentLength, 10)
    let loaded = 0
    const reader = response.body.getReader()
    const chunks: BlobPart[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as BlobPart)
      loaded += value.length
      const progress = 55 + Math.round((loaded / total) * 40) // 55-95%
      onProgress?.(progress, getExportStatus(progress, true))
    }

    onProgress?.(96, 'finalizing')
    const blob = new Blob(chunks)
    onProgress?.(100, 'complete')
    return blob
  }

  onProgress?.(90, 'downloading')
  const blob = await response.blob()
  onProgress?.(96, 'finalizing')
  onProgress?.(100, 'complete')
  return blob
}

/**
 * Trigger download of a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

/**
 * Analyze a LearnHouse course export package for import
 */
export async function analyzeImportPackage(
  file: File,
  org_id: number,
  access_token: string | null | undefined
): Promise<ImportAnalysisResponse> {
  const formData = new FormData()
  formData.append('zip_file', file)

  const response = await fetch(
    `${getAPIUrl()}courses/import/analyze?org_id=${org_id}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      body: formData,
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Analysis failed' }))
    throw new Error(error.detail || 'Failed to analyze package')
  }

  return response.json()
}

/**
 * Import courses from an analyzed package
 */
export async function importCourses(
  temp_id: string,
  org_id: number,
  options: ImportOptions,
  access_token: string | null | undefined
): Promise<ImportResult> {
  const response = await fetch(
    `${getAPIUrl()}courses/import?org_id=${org_id}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        temp_id,
        ...options,
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Import failed' }))
    throw new Error(error.detail || 'Failed to import courses')
  }

  return response.json()
}
