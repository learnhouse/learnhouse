/*
 In-flight uploads for the activity editor.

 Collaboration rule: an upload in progress is LOCAL state. It never goes into
 the ProseMirror document (so it never reaches the Y doc or other editors).
 The document only changes once, when the server has stored the file and we
 have the final `blockObject`. Placeholders on the page (drop/paste) and the
 progress bar inside an empty block both read from this store.

 The store keeps the original File so a failed upload can be retried without
 asking the author to pick it again. Nothing here survives a reload, by
 design: an interrupted upload simply never lands in the document.
*/
import { getAPIUrl } from '@services/config/config'
import { uploadFormWithProgress } from '@services/utils/ts/requests'
import { MEDIA_KINDS, MediaKind, validateFile } from './mediaKinds'
import { downscaleImage } from './downscale'

export type UploadStatus = 'preparing' | 'uploading' | 'processing' | 'error' | 'done'

export interface UploadTask {
  id: string
  kind: MediaKind
  fileName: string
  fileSize: number
  progress: number
  status: UploadStatus
  /** Error code for known failures (validation), or a server message. */
  error?: string
  errorCode?: 'type' | 'size' | 'empty' | 'cancelled' | 'server'
  /** Object URL for image previews while uploading. */
  previewUrl?: string
}

interface TaskInternals {
  file: File
  activityUuid: string
  getToken: () => string | undefined
  controller: AbortController | null
  onDone: (_result: any, _task: UploadTask) => void
}

type Listener = () => void

const tasks = new Map<string, UploadTask>()
const internals = new Map<string, TaskInternals>()
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function patch(id: string, update: Partial<UploadTask>) {
  const current = tasks.get(id)
  if (!current) return
  tasks.set(id, { ...current, ...update })
  emit()
}

export function subscribeUploads(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getUploadTask(id: string | null | undefined): UploadTask | undefined {
  return id ? tasks.get(id) : undefined
}

let counter = 0
function newId() {
  counter += 1
  return `up_${Date.now().toString(36)}_${counter}`
}

/** POST the file to the block's existing upload endpoint. */
export function uploadBlockFile(
  kind: MediaKind,
  file: File,
  activityUuid: string,
  accessToken: string,
  onProgress?: (_percent: number) => void,
  signal?: AbortSignal,
): Promise<any> {
  const formData = new FormData()
  formData.append('file_object', file)
  formData.append('activity_uuid', activityUuid)
  return uploadFormWithProgress(
    `${getAPIUrl()}${MEDIA_KINDS[kind].endpoint}`,
    formData,
    accessToken,
    onProgress,
    { signal },
  )
}

async function run(id: string) {
  const task = tasks.get(id)
  const inner = internals.get(id)
  if (!task || !inner) return

  const controller = new AbortController()
  inner.controller = controller
  patch(id, { status: 'preparing', progress: 0, error: undefined, errorCode: undefined })

  try {
    let file = inner.file
    if (task.kind === 'image') {
      file = await downscaleImage(file)
      if (controller.signal.aborted) {
        patch(id, { status: 'error', errorCode: 'cancelled' })
        return
      }
      if (file !== inner.file) {
        // Keep the smaller copy for retries too.
        inner.file = file
        patch(id, { fileSize: file.size })
      }
    }

    const check = validateFile(file, task.kind)
    if (!check.ok) {
      patch(id, { status: 'error', errorCode: check.code })
      return
    }

    const token = inner.getToken()
    if (!token) {
      patch(id, { status: 'error', errorCode: 'server', error: 'Not signed in' })
      return
    }

    patch(id, { status: 'uploading' })
    const result = await uploadBlockFile(
      task.kind,
      file,
      inner.activityUuid,
      token,
      (p) => {
        // The last few percent are the server storing and checking the file.
        patch(id, p >= 100 ? { progress: 100, status: 'processing' } : { progress: p })
      },
      controller.signal,
    )
    if (controller.signal.aborted) {
      patch(id, { status: 'error', errorCode: 'cancelled' })
      return
    }
    patch(id, { status: 'done', progress: 100 })
    inner.onDone(result, tasks.get(id)!)
  } catch (err: any) {
    if (controller.signal.aborted) {
      patch(id, { status: 'error', errorCode: 'cancelled' })
      return
    }
    patch(id, { status: 'error', errorCode: 'server', error: err?.message || 'Upload failed' })
  } finally {
    if (inner.controller === controller) inner.controller = null
  }
}

export interface StartUploadOptions {
  kind: MediaKind
  file: File
  activityUuid: string
  getToken: () => string | undefined
  onDone: (_result: any, _task: UploadTask) => void
}

/** Create a task and start uploading right away. Returns the task id. */
export function startUpload(opts: StartUploadOptions): string {
  const id = newId()
  const previewUrl =
    opts.kind === 'image' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(opts.file)
      : undefined
  tasks.set(id, {
    id,
    kind: opts.kind,
    fileName: opts.file.name || opts.kind,
    fileSize: opts.file.size,
    progress: 0,
    status: 'preparing',
    previewUrl,
  })
  internals.set(id, {
    file: opts.file,
    activityUuid: opts.activityUuid,
    getToken: opts.getToken,
    controller: null,
    onDone: opts.onDone,
  })
  emit()
  void run(id)
  return id
}

export function cancelUpload(id: string) {
  const inner = internals.get(id)
  inner?.controller?.abort()
  if (!inner?.controller) patch(id, { status: 'error', errorCode: 'cancelled' })
}

export function retryUpload(id: string) {
  const task = tasks.get(id)
  if (!task || task.status !== 'error') return
  void run(id)
}

/** Forget a task (after it landed in the doc, or when the author dismisses it). */
export function discardUpload(id: string) {
  const task = tasks.get(id)
  internals.get(id)?.controller?.abort()
  if (task?.previewUrl) {
    try {
      URL.revokeObjectURL(task.previewUrl)
    } catch {
      /* already revoked */
    }
  }
  tasks.delete(id)
  internals.delete(id)
  emit()
}

/** True while any upload hasn't landed yet (used to warn before leaving). */
export function hasPendingUploads(): boolean {
  for (const t of tasks.values()) {
    if (t.status === 'preparing' || t.status === 'uploading' || t.status === 'processing') return true
  }
  return false
}
