import toast from 'react-hot-toast'
import { getUriWithOrg } from '@services/config/config'
import { removeFolderPrefix } from '@services/folders/folders'

/**
 * Build the public, shareable URL for a folder.
 * Always points at the public /library/folder/{id} route (not the dashboard one).
 */
export function getFolderShareUrl(orgslug: string, folderUuid: string): string {
  const path = getUriWithOrg(orgslug, `/library/folder/${removeFolderPrefix(folderUuid)}`)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  if (/^https?:\/\//i.test(path)) return path
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Copy the folder's public link to the clipboard (with a native share sheet
 * fallback on supported devices). Shows a toast.
 */
export async function shareFolderLink(
  orgslug: string,
  folderUuid: string,
  folderName: string,
  copiedLabel: string,
  errorLabel: string,
) {
  const url = getFolderShareUrl(orgslug, folderUuid)
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null
    if (nav?.share && /Mobi|Android|iPhone|iPad/i.test(nav.userAgent || '')) {
      await nav.share({ title: folderName, url })
      return
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(url)
      toast.success(copiedLabel)
      return
    }
    throw new Error('clipboard unavailable')
  } catch (e: any) {
    if (e?.name === 'AbortError') return // user dismissed the share sheet
    toast.error(errorLabel)
  }
}
