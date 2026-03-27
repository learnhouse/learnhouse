import { getAPIUrl } from '@services/config/config'

export interface UploadedFileInfo {
  file_id: string
  filename: string
  file_type: string
  size: number
  extension: string
}

export interface MigrationActivityNode {
  name: string
  activity_type: string
  activity_sub_type: string
  file_ids: string[]
}

export interface MigrationChapterNode {
  name: string
  activities: MigrationActivityNode[]
}

export interface MigrationTreeStructure {
  course_name: string
  course_description?: string
  chapters: MigrationChapterNode[]
}

export interface MigrationCreateResult {
  course_uuid: string
  course_name: string
  chapters_created: number
  activities_created: number
  success: boolean
  error?: string
}

export type UploadProgressCallback = (
  uploaded: number,
  total: number,
  currentFile: string
) => void

export interface MigrationUploadResponse {
  temp_id: string
  files: UploadedFileInfo[]
  skipped: string[]
}

// Batch ceiling: keep each request under ~200MB to avoid gateway timeouts.
// Large files (>100MB) are sent individually.
const BATCH_MAX_BYTES = 200 * 1024 * 1024
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024

export async function uploadMigrationFiles(
  files: File[],
  org_id: number,
  access_token: string,
  onProgress?: UploadProgressCallback
): Promise<MigrationUploadResponse> {
  let tempId: string | null = null
  let allUploadedFiles: UploadedFileInfo[] = []
  let allSkipped: string[] = []

  // Build batches by byte size: large files go solo, small files are grouped
  const batches: File[][] = []
  let currentBatch: File[] = []
  let currentBatchSize = 0

  for (const file of files) {
    if (file.size > LARGE_FILE_THRESHOLD) {
      // Flush any pending small-file batch first
      if (currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchSize = 0
      }
      batches.push([file])
    } else {
      if (currentBatchSize + file.size > BATCH_MAX_BYTES && currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchSize = 0
      }
      currentBatch.push(file)
      currentBatchSize += file.size
    }
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  let filesUploaded = 0

  for (const batch of batches) {
    if (onProgress) {
      onProgress(filesUploaded, files.length, batch[0]?.name || '')
    }

    const formData = new FormData()
    for (const file of batch) {
      formData.append('files', file)
    }

    const tempIdParam = tempId ? `&temp_id=${tempId}` : ''
    const response = await fetch(
      `${getAPIUrl()}courses/migrate/upload?org_id=${org_id}${tempIdParam}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}` },
        body: formData,
      }
    )

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }

    const result: MigrationUploadResponse = await response.json()
    tempId = result.temp_id
    allUploadedFiles = [...allUploadedFiles, ...result.files]
    allSkipped = [...allSkipped, ...result.skipped]
    filesUploaded += batch.length
  }

  if (onProgress) {
    onProgress(files.length, files.length, '')
  }

  return {
    temp_id: tempId!,
    files: allUploadedFiles,
    skipped: allSkipped,
  }
}

export async function suggestStructure(
  temp_id: string,
  course_name: string,
  description: string | undefined,
  org_id: number,
  access_token: string
): Promise<MigrationTreeStructure> {
  const response = await fetch(
    `${getAPIUrl()}courses/migrate/suggest?org_id=${org_id}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ temp_id, course_name, description }),
    }
  )

  if (!response.ok) {
    throw new Error(`Suggestion failed: ${response.statusText}`)
  }

  return response.json()
}

export async function createFromMigration(
  temp_id: string,
  structure: MigrationTreeStructure,
  org_id: number,
  access_token: string
): Promise<MigrationCreateResult> {
  const response = await fetch(
    `${getAPIUrl()}courses/migrate/create?org_id=${org_id}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ temp_id, structure }),
    }
  )

  if (!response.ok) {
    throw new Error(`Creation failed: ${response.statusText}`)
  }

  return response.json()
}
