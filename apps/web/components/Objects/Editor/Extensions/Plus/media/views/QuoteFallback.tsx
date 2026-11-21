'use client'
/*
 The quote block while its view's chunk loads (see ../../lazyView): the
 learner markup of QuoteBlockView with the quote mark left as an empty box
 of the same size, so the text shows at once and nothing moves.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { cn } from '@/lib/utils'
import { oneOf, QUOTE_VARIANTS, safeUrl } from '../mediaModel'
import { QUOTE_FRAME, QUOTE_TEXT, initials } from './quoteStyles'

export default function QuoteFallback({ node }: NodeViewProps) {
  const variant = oneOf(QUOTE_VARIANTS, node.attrs.variant, 'pull')
  const author: string = typeof node.attrs.author === 'string' ? node.attrs.author : ''
  const role: string = typeof node.attrs.role === 'string' ? node.attrs.role : ''
  const avatar = safeUrl(node.attrs.avatarUrl)
  const mark = variant === 'pull' ? 30 : 22
  return (
    <NodeViewWrapper className="lh-quote-block my-5" data-variant={variant}>
      <figure className={cn('m-0', QUOTE_FRAME[variant])}>
        {variant !== 'highlight' && (
          <span aria-hidden contentEditable={false} className={cn('mb-2 flex text-violet-500/80', variant === 'pull' ? 'justify-center' : '')}>
            <span style={{ width: mark, height: mark }} />
          </span>
        )}
        <blockquote className={cn('m-0 border-0 p-0', QUOTE_TEXT[variant])}>
          <NodeViewContent className="lh-quote-body" />
        </blockquote>
        {(author || role) && (
          <figcaption contentEditable={false} className={cn('mt-3 flex items-center gap-3 text-sm', variant === 'pull' ? 'justify-center' : '')}>
            {variant === 'testimonial' &&
              (avatar ? (
                <img src={avatar} alt="" className="h-10 w-10 flex-none rounded-full object-cover ring-1 ring-black/5" />
              ) : author ? (
                <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                  {initials(author)}
                </span>
              ) : null)}
            <span className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1.5', variant === 'testimonial' ? 'flex-col items-start gap-y-0' : '', variant === 'pull' ? 'justify-center' : '')}>
              {variant !== 'testimonial' && author && <span aria-hidden className="text-neutral-400">—</span>}
              {author && <cite className="font-semibold not-italic text-neutral-900">{author}</cite>}
              {role && <span className="text-neutral-500">{role}</span>}
            </span>
          </figcaption>
        )}
      </figure>
    </NodeViewWrapper>
  )
}
