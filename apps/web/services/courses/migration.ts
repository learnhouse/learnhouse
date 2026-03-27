import { getAPIUrl } from '@services/config/config'

export interface UploadedFileInfo {
  file_id: string
  filename: string
  file_type: string
  size: number
  extension: string
}

export interface MigrationUploadResponse {
  temp_id: string
  files: UploadedFileInfo[]
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

const CHUNK_SIZE = 5 // Upload 5 files at a time

export async function uploadMigrationFiles(
  files: File[],
  org_id: number,
  access_token: string,
  onProgress?: UploadProgressCallback
): Promise<MigrationUploadResponse> {
  // Upload files in small batches to avoid timeout on large uploads
  let tempId: string | null = null
  let allUploadedFiles: UploadedFileInfo[] = []

  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const batch = files.slice(i, i + CHUNK_SIZE)

    if (onProgress) {
      onProgress(i, files.length, batch[0]?.name || '')
    }

    const formData = new FormData()
    for (const file of batch) {
      formData.append('files', file)
    }

    // On subsequent batches, include temp_id to append to existing package
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
  }

  if (onProgress) {
    onProgress(files.length, files.length, '')
  }

  return {
    temp_id: tempId!,
    files: allUploadedFiles,
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
