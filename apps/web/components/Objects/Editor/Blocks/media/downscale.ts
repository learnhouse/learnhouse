/*
 Client-side downscale for very large photos.

 Phone photos and screenshots on retina screens are routinely 4000-8000 px
 wide and 5-20 MB, far more than a lesson column (≈ 800 px) can show even on
 a 3x display. Shrinking them before upload makes the upload faster, keeps
 them under the 15 MB image limit and makes the lesson lighter for learners.

 Rules (kept conservative so nothing a teacher cares about gets mangled):
 - GIFs are never touched (re-encoding would drop the animation).
 - Only images whose longest edge is over MAX_EDGE, or whose file is over
   the soft byte limit, are re-encoded.
 - PNG stays PNG (screenshots, transparency, crisp text); JPEG and WebP become
   WebP at high quality.
 - If the result isn't smaller, the original is kept.
*/

export const MAX_EDGE = 2560
export const SOFT_MAX_BYTES = 4 * 1024 * 1024
const WEBP_QUALITY = 0.88

export interface DownscalePlan {
  resize: boolean
  width: number
  height: number
  outputType: string
}

/** Decide whether and how to shrink an image. Pure, unit tested. */
export function planDownscale(
  width: number,
  height: number,
  bytes: number,
  mime: string,
  maxEdge = MAX_EDGE,
): DownscalePlan {
  const type = (mime || '').toLowerCase()
  const keep: DownscalePlan = { resize: false, width, height, outputType: type }
  if (!width || !height) return keep
  if (type === 'image/gif' || type === 'image/svg+xml') return keep
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return keep

  const longest = Math.max(width, height)
  const tooBig = longest > maxEdge
  const tooHeavy = bytes > SOFT_MAX_BYTES
  if (!tooBig && !tooHeavy) return keep

  const scale = tooBig ? maxEdge / longest : 1
  return {
    resize: true,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    outputType: type === 'image/png' ? 'image/png' : 'image/webp',
  }
}

function renameForType(name: string, type: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image'
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  return `${base}.${ext}`
}

/**
 * Return a smaller copy of `file` when the plan says so, else `file` itself.
 * Never throws: any decoding/encoding failure falls back to the original.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const plan = planDownscale(bitmap.width, bitmap.height, file.size, file.type)
    if (!plan.resize) return file

    const canvas = document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height)

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, plan.outputType, plan.outputType === 'image/webp' ? WEBP_QUALITY : undefined),
    )
    // Some browsers silently fall back to PNG when they can't encode WebP.
    if (!blob || blob.size === 0 || blob.size >= file.size) return file
    return new File([blob], renameForType(file.name, blob.type || plan.outputType), {
      type: blob.type || plan.outputType,
      lastModified: Date.now(),
    })
  } catch {
    return file
  } finally {
    bitmap?.close?.()
  }
}
