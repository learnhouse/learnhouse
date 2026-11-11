import fs from 'node:fs'
import path from 'node:path'
import { VIDEOS } from '../../lib/videos'
import YouTubePlayer from './YouTubePlayer'

// Local thumbnail from scripts/video-thumbs.mjs when there is one; YouTube's otherwise.
function thumbnailFor(id) {
  const local = `/img/videos/${id}.webp`
  return fs.existsSync(path.join(process.cwd(), 'public', local)) ? local : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

// Embeds a video guide from lib/videos.js. Renders nothing while the video has
// no YouTube ID yet, so a page can hold the slot before the video is public.
export default function YouTube({ video }) {
  const entry = VIDEOS[video]
  if (!entry?.youtubeId) return null

  return (
    <figure className="lh-video">
      <div className="lh-video-frame">
        <YouTubePlayer id={entry.youtubeId} title={entry.title} thumbnail={thumbnailFor(entry.youtubeId)} />
      </div>
      <figcaption>{entry.title}</figcaption>
    </figure>
  )
}
