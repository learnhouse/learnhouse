import React from 'react'
import { splitLinks } from '@lib/text/linkify'

interface LinkifiedTextProps {
  text?: string | null
  className?: string
  linkClassName?: string
}

/**
 * Renders plain text (as typed in a textarea) with the web links it contains
 * turned into anchors. Line breaks are kept by the caller's `whitespace-pre-line`.
 */
export default function LinkifiedText({
  text,
  className,
  linkClassName = 'text-blue-600 underline underline-offset-2 hover:text-blue-800 break-all',
}: LinkifiedTextProps) {
  const segments = splitLinks(text)
  return (
    <p className={className}>
      {segments.map((segment, index) =>
        segment.type === 'link' ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={linkClassName}
          >
            {segment.value}
          </a>
        ) : (
          <React.Fragment key={index}>{segment.value}</React.Fragment>
        )
      )}
    </p>
  )
}
