import React from 'react'

// A chapter's emoji lives in `extra_metadata.emoji` (no column of its own).
// Anything that isn't a short string is ignored, so odd data never renders.
export function getChapterEmoji(chapter: any): string {
  const value = chapter?.extra_metadata?.emoji
  return typeof value === 'string' && value.trim() && value.length <= 16 ? value.trim() : ''
}

// The emoji before a chapter name, sized by the surrounding text. Decorative:
// hidden from screen readers so the name reads on its own. Renders nothing
// when the chapter has no emoji.
export function ChapterEmoji({ chapter, emoji, className = '' }: { chapter?: any; emoji?: string; className?: string }) {
  const value = emoji ?? getChapterEmoji(chapter)
  if (!value) return null
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 leading-none me-[0.35em] ${className}`}>
      {value}
    </span>
  )
}

export default ChapterEmoji
