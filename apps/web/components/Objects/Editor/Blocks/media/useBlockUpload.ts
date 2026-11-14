'use client'
import React from 'react'
import { MediaKind, validateFile, FileValidation } from './mediaKinds'
import {
  UploadTask,
  cancelUpload,
  discardUpload,
  getUploadTask,
  retryUpload,
  startUpload,
  subscribeUploads,
} from './uploadStore'

interface Options {
  kind: MediaKind
  activityUuid: string | undefined
  accessToken: string | undefined
  /** Called once with the server's BlockRead; write node attrs here. */
  onUploaded: (_blockObject: any) => void
}

export interface BlockUpload {
  task: UploadTask | undefined
  /** Up-front validation failure for the last picked file. */
  rejection: (Extract<FileValidation, { ok: false }> & { fileSize: number }) | null
  start: (_file: File) => boolean
  cancel: () => void
  retry: () => void
  dismiss: () => void
}

/**
 * Upload a file from inside a block (its empty state or "Replace").
 * Progress lives in the local upload store; the node's attrs are written once,
 * with the final blockObject, when the server has the file.
 */
export function useBlockUpload({ kind, activityUuid, accessToken, onUploaded }: Options): BlockUpload {
  const [taskId, setTaskId] = React.useState<string | null>(null)
  const [rejection, setRejection] = React.useState<BlockUpload['rejection']>(null)
  const task = React.useSyncExternalStore(
    subscribeUploads,
    () => getUploadTask(taskId),
    () => undefined,
  )

  const onUploadedRef = React.useRef(onUploaded)
  onUploadedRef.current = onUploaded
  const tokenRef = React.useRef(accessToken)
  tokenRef.current = accessToken

  // A block removed mid-upload stops its upload.
  const taskIdRef = React.useRef<string | null>(null)
  taskIdRef.current = taskId
  React.useEffect(() => () => {
    if (taskIdRef.current) discardUpload(taskIdRef.current)
  }, [])

  const start = React.useCallback(
    (file: File) => {
      // Oversized images may still fit after the client-side downscale, so
      // for images only the type is checked here; the store re-checks size.
      const check = validateFile(file, kind)
      if (!check.ok && !(kind === 'image' && check.code === 'size')) {
        setRejection({ ...check, fileSize: file.size })
        return false
      }
      if (!activityUuid) return false
      setRejection(null)
      if (taskIdRef.current) discardUpload(taskIdRef.current)
      const id = startUpload({
        kind,
        file,
        activityUuid,
        getToken: () => tokenRef.current,
        onDone: (result) => {
          onUploadedRef.current(result)
          discardUpload(id)
          setTaskId((cur) => (cur === id ? null : cur))
        },
      })
      setTaskId(id)
      return true
    },
    [kind, activityUuid],
  )

  const cancel = React.useCallback(() => {
    if (!taskIdRef.current) return
    cancelUpload(taskIdRef.current)
    discardUpload(taskIdRef.current)
    setTaskId(null)
  }, [])

  const retry = React.useCallback(() => {
    if (taskIdRef.current) retryUpload(taskIdRef.current)
  }, [])

  const dismiss = React.useCallback(() => {
    if (taskIdRef.current) discardUpload(taskIdRef.current)
    setTaskId(null)
    setRejection(null)
  }, [])

  return { task, rejection, start, cancel, retry, dismiss }
}
