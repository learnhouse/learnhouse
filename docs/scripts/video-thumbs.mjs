// Downloads each published video's YouTube thumbnail into public/img/videos as
// a small WebP, so pages don't wait on YouTube's image server. Run after adding
// a youtubeId to lib/videos.js: node scripts/video-thumbs.mjs (then commit the image)
import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { VIDEOS } from '../lib/videos.js'

const out = path.join(import.meta.dirname, '../public/img/videos')

for (const { youtubeId } of Object.values(VIDEOS)) {
  if (!youtubeId) continue
  const file = path.join(out, `${youtubeId}.webp`)
  if (existsSync(file)) continue
  const res = await fetch(`https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`).then((r) =>
    r.ok ? r : fetch(`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`),
  )
  if (!res.ok) {
    console.warn(`no thumbnail for ${youtubeId}`)
    continue
  }
  await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 960, height: 540, fit: 'cover' }).webp({ quality: 78 }).toFile(file)
  console.log(`saved ${youtubeId}.webp`)
}
