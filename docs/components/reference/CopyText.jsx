'use client'

import CopyButton from './CopyButton'

/** Copy button for a fixed string (paths, base URLs). */
export default function CopyText({ text, label }) {
  return <CopyButton getText={() => text} label={label || `Copy ${text}`} />
}
