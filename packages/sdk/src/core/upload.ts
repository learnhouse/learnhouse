/**
 * A file to upload: a `File` or `Blob` (browsers, Node 18+, Bun, Deno), or
 * React Native's `{ uri, name, type }` object, which RN's FormData sends as a
 * file part.
 */
export type UploadFile = Blob | ReactNativeFile

export interface ReactNativeFile {
  uri: string
  name: string
  type: string
}

function isReactNativeFile(file: unknown): file is ReactNativeFile {
  return (
    typeof file === 'object' &&
    file !== null &&
    typeof (file as { uri?: unknown }).uri === 'string' &&
    !(typeof Blob !== 'undefined' && file instanceof Blob)
  )
}

/** Appends `file` as a file part; a bare Blob (no name) gets `fallbackName`. */
export function appendFile(form: FormData, field: string, file: UploadFile, fallbackName: string): void {
  if (isReactNativeFile(file)) {
    // React Native's FormData reads { uri, name, type } as a file.
    form.append(field, file as unknown as Blob)
    return
  }
  const name = (file as Blob & { name?: unknown }).name
  if (typeof name === 'string' && name) form.append(field, file)
  else form.append(field, file, fallbackName)
}
