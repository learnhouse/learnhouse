'use client'

import React, { useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { Components as MarkdownComponents } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@components/ui/hover-card'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { getActivity } from '@services/courses/activities'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { Loader2 } from 'lucide-react'

// Shared, lightweight activity preview. Two surfaces:
//
//   <ActivityPreview activity={...} />         // inline body (Atlas, modals)
//   <ActivityPreviewHoverCard activity={...}>  // hover-card wrapper around a trigger
//     <p>Activity name</p>
//   </ActivityPreviewHoverCard>
//
// The inline form renders content directly from whatever `activity` it was
// given. If the activity only has metadata (no `content` field), it can be
// asked to fetch the full detail by passing `autoFetch`. Callers that want
// to preview *unsaved* edits (e.g. Atlas previewing a tool-proposed change)
// should merge their draft into the `activity` object and pass `autoFetch`
// as false so the component doesn't overwrite the draft with the saved
// version.

export type ActivityPreviewProps = {
  /**
   * Activity object to preview. May be a metadata-only summary, a full
   * detail record returned by `getActivity`, or a draft (saved + edits)
   * the caller wants to preview before applying.
   */
  activity: any
  /**
   * When true and `activity.content` is missing/empty, fetch the full
   * activity detail via the API. Defaults to true. Set false when the
   * caller is supplying a draft and doesn't want it overwritten.
   */
  autoFetch?: boolean
  /** Optional extra class on the scroll container. */
  className?: string
}

// ──────────────────────────────────────────────────────────────────────────
// ProseMirror/TipTap JSON → React renderer
// ──────────────────────────────────────────────────────────────────────────

type RendererCtx = {
  orgUuid?: string
  courseUuid?: string
  activityUuid?: string
}

function applyMarks(text: React.ReactNode, marks?: any[]): React.ReactNode {
  if (!marks || marks.length === 0) return text
  return marks.reduce<React.ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        return <strong className="font-semibold">{acc}</strong>
      case 'italic':
      case 'em':
        return <em>{acc}</em>
      case 'underline':
        return <span className="underline">{acc}</span>
      case 'strike':
        return <span className="line-through">{acc}</span>
      case 'code':
        return (
          <code className="px-1 py-[1px] rounded bg-gray-100 text-[11px] font-mono text-gray-800">
            {acc}
          </code>
        )
      case 'link': {
        const href: string = mark.attrs?.href || '#'
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-blue-600 hover:underline"
          >
            {acc}
          </a>
        )
      }
      default:
        return acc
    }
  }, text)
}

function renderChildren(nodes: any[] | undefined, ctx: RendererCtx): React.ReactNode {
  if (!nodes) return null
  return nodes.map((n, i) => <PMNode key={i} node={n} ctx={ctx} />)
}

function PMNode({ node, ctx }: { node: any; ctx: RendererCtx }): React.ReactElement | null {
  if (!node) return null
  switch (node.type) {
    case 'doc':
      return <>{renderChildren(node.content, ctx)}</>
    case 'paragraph':
      return (
        <p className="text-xs text-gray-700 leading-relaxed my-1.5">
          {renderChildren(node.content, ctx)}
        </p>
      )
    case 'heading': {
      const lvl = Math.min(Math.max(node.attrs?.level || 2, 1), 6)
      const cls = [
        '',
        'text-base font-bold text-gray-800 mt-3 mb-1',
        'text-sm font-bold text-gray-800 mt-3 mb-1',
        'text-sm font-semibold text-gray-800 mt-2 mb-1',
        'text-xs font-semibold text-gray-700 mt-2 mb-1',
        'text-xs font-semibold text-gray-700 mt-1.5 mb-1',
        'text-[11px] font-semibold uppercase tracking-wider text-gray-500 mt-1.5 mb-1',
      ][lvl]
      const Tag = `h${lvl}` as keyof React.JSX.IntrinsicElements
      return <Tag className={cls}>{renderChildren(node.content, ctx)}</Tag>
    }
    case 'bulletList':
      return (
        <ul className="list-disc pl-5 my-1.5 text-xs text-gray-700 leading-relaxed space-y-0.5">
          {renderChildren(node.content, ctx)}
        </ul>
      )
    case 'orderedList':
      return (
        <ol className="list-decimal pl-5 my-1.5 text-xs text-gray-700 leading-relaxed space-y-0.5">
          {renderChildren(node.content, ctx)}
        </ol>
      )
    case 'listItem':
      return <li>{renderChildren(node.content, ctx)}</li>
    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-gray-200 pl-3 my-2 text-xs text-gray-600 italic">
          {renderChildren(node.content, ctx)}
        </blockquote>
      )
    case 'codeBlock':
      return (
        <pre className="my-2 p-2 rounded-md bg-gray-50 border border-gray-100 text-[11px] font-mono text-gray-800 overflow-x-auto whitespace-pre-wrap">
          <code>{renderChildren(node.content, ctx)}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr className="my-2 border-gray-100" />
    case 'hardBreak':
      return <br />
    case 'text':
      return <>{applyMarks(node.text || '', node.marks)}</>
    case 'image': {
      const src = node.attrs?.src
      if (!src) return null
      return (
        <img
          src={src}
          alt={node.attrs?.alt || ''}
          loading="lazy"
          className="my-2 rounded-md max-w-full h-auto border border-gray-100"
        />
      )
    }
    case 'blockImage': {
      const unsplashUrl: string | undefined = node.attrs?.unsplash_url || undefined
      const blockObject = node.attrs?.blockObject
      let src: string | undefined = unsplashUrl || undefined
      if (!src && blockObject && ctx.orgUuid && ctx.courseUuid) {
        const fileId = `${blockObject.content?.file_id}.${blockObject.content?.file_format}`
        src = getActivityBlockMediaDirectory(
          ctx.orgUuid,
          ctx.courseUuid,
          blockObject.content?.activity_uuid || ctx.activityUuid || '',
          blockObject.block_uuid,
          fileId,
          'imageBlock',
        )
      }
      if (!src) return null
      const align = node.attrs?.alignment || 'center'
      const justify =
        align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center'
      return (
        <div className={`flex ${justify} my-2`}>
          <img
            src={src}
            alt=""
            loading="lazy"
            className="rounded-md max-w-full h-auto border border-gray-100"
            style={{ maxHeight: 180 }}
          />
        </div>
      )
    }
    default:
      // Fall back to rendering children so unknown wrappers don't swallow text.
      if (Array.isArray(node.content)) {
        return <>{renderChildren(node.content, ctx)}</>
      }
      return null
  }
}

function hasAnyRenderableContent(content: any): boolean {
  if (!content || typeof content !== 'object') return false
  if (Array.isArray(content.content) && content.content.length > 0) return true
  return false
}

// ──────────────────────────────────────────────────────────────────────────
// Markdown rendering (used for SUBTYPE_DYNAMIC_MARKDOWN + assignments)
// ──────────────────────────────────────────────────────────────────────────

function toRawUrl(url: string): string {
  const gh = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`
  const gl = url.match(/^(https?:\/\/gitlab\.com\/.+)\/-\/blob\/(.+)$/)
  if (gl) return `${gl[1]}/-/raw/${gl[2]}`
  const bb = url.match(/^(https?:\/\/bitbucket\.org\/[^/]+\/[^/]+)\/src\/(.+)$/)
  if (bb) return `${bb[1]}/raw/${bb[2]}`
  return url
}

const markdownComponents: MarkdownComponents = {
  h1: ({ node, ...p }) => <h1 className="text-base font-bold text-gray-800 mt-3 mb-1" {...p} />,
  h2: ({ node, ...p }) => <h2 className="text-sm font-bold text-gray-800 mt-3 mb-1" {...p} />,
  h3: ({ node, ...p }) => <h3 className="text-sm font-semibold text-gray-800 mt-2 mb-1" {...p} />,
  h4: ({ node, ...p }) => <h4 className="text-xs font-semibold text-gray-700 mt-2 mb-1" {...p} />,
  h5: ({ node, ...p }) => <h5 className="text-xs font-semibold text-gray-700 mt-1.5 mb-1" {...p} />,
  h6: ({ node, ...p }) => (
    <h6 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mt-1.5 mb-1" {...p} />
  ),
  p: ({ node, ...p }) => <p className="my-1.5" {...p} />,
  ul: ({ node, ...p }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5" {...p} />,
  ol: ({ node, ...p }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5" {...p} />,
  li: ({ node, ...p }) => <li {...p} />,
  blockquote: ({ node, ...p }) => (
    <blockquote className="border-l-2 border-gray-200 pl-3 my-2 text-gray-600 italic" {...p} />
  ),
  hr: () => <hr className="my-2 border-gray-100" />,
  a: ({ node, ...p }) => (
    <a
      {...p}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-blue-600 hover:underline"
    />
  ),
  strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
  code: ({ node, className, children, ...p }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code className="px-1 py-[1px] rounded bg-gray-100 text-[11px] font-mono text-gray-800" {...p}>
          {children}
        </code>
      )
    }
    return (
      <code className={`block font-mono text-[11px] text-gray-800 ${className || ''}`} {...p}>
        {children}
      </code>
    )
  },
  pre: ({ node, ...p }) => (
    <pre
      className="my-2 p-2 rounded-md bg-gray-50 border border-gray-100 overflow-x-auto whitespace-pre-wrap"
      {...p}
    />
  ),
  img: ({ node, ...p }) => (
    <img
      {...p}
      loading="lazy"
      className="my-2 rounded-md max-w-full h-auto border border-gray-100"
      style={{ maxHeight: 180 }}
    />
  ),
  table: ({ node, ...p }) => (
    <div className="my-2 overflow-x-auto">
      <table className="text-[11px] border-collapse" {...p} />
    </div>
  ),
  th: ({ node, ...p }) => <th className="border border-gray-200 px-2 py-1 bg-gray-50 text-left" {...p} />,
  td: ({ node, ...p }) => <td className="border border-gray-200 px-2 py-1" {...p} />,
}

function MarkdownPreview({ url }: { url: string }) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; text: string }
  >({ kind: 'idle' })

  useEffect(() => {
    if (!url) {
      setState({ kind: 'error', message: 'No markdown URL configured' })
      return
    }
    let cancelled = false
    setState({ kind: 'loading' })
    fetch(toRawUrl(url))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setState({ kind: 'ready', text })
      })
      .catch((err) => {
        if (!cancelled)
          setState({ kind: 'error', message: err?.message || 'Failed to load' })
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
        <Loader2 size={12} className="animate-spin" />
        Loading markdown…
      </div>
    )
  }
  if (state.kind === 'error') {
    return <EmptyState text={state.message} />
  }
  if (state.kind === 'ready') {
    return (
      <div className="text-xs text-gray-700 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {state.text.slice(0, 6000)}
        </ReactMarkdown>
      </div>
    )
  }
  return null
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 italic">{text}</p>
}

// ──────────────────────────────────────────────────────────────────────────
// Body renderer — picks a strategy per activity type
// ──────────────────────────────────────────────────────────────────────────

function PreviewBody({ activity }: { activity: any }) {
  const org = useOrg() as any
  const course = useCourse() as any
  const type = activity.activity_type
  const sub = activity.activity_sub_type
  const content = activity.content || {}

  const rendererCtx: RendererCtx = useMemo(
    () => ({
      orgUuid: org?.org_uuid,
      courseUuid: course?.courseStructure?.course_uuid,
      activityUuid: activity?.activity_uuid,
    }),
    [org?.org_uuid, course?.courseStructure?.course_uuid, activity?.activity_uuid],
  )

  if (type === 'TYPE_DYNAMIC' && sub === 'SUBTYPE_DYNAMIC_MARKDOWN') {
    return <MarkdownPreview url={content.markdown_url || ''} />
  }

  if (type === 'TYPE_DYNAMIC' && sub === 'SUBTYPE_DYNAMIC_EMBED') {
    const url: string = content.embed_url || ''
    if (!url) return <EmptyState text="No embed URL configured" />
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-blue-600 hover:underline break-all block"
      >
        {url}
      </a>
    )
  }

  if (type === 'TYPE_DYNAMIC') {
    if (!hasAnyRenderableContent(content)) {
      return <EmptyState text="This page is empty" />
    }
    return <PMNode node={content} ctx={rendererCtx} />
  }

  if (type === 'TYPE_VIDEO') {
    if (content.uri) {
      return (
        <a
          href={content.uri}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-blue-600 hover:underline break-all block"
        >
          {content.uri}
        </a>
      )
    }
    if (content.filename) {
      return <p className="text-xs text-gray-600 break-all">{content.filename}</p>
    }
    return <EmptyState text="No video source set" />
  }

  if (type === 'TYPE_DOCUMENT') {
    if (content.filename) {
      return <p className="text-xs text-gray-600 break-all">{content.filename}</p>
    }
    return <EmptyState text="No document attached" />
  }

  if (type === 'TYPE_ASSIGNMENT') {
    const description: string = content.description || activity.description || ''
    if (!description) return <EmptyState text="Assignment — open to view details" />
    return (
      <div className="text-xs text-gray-700 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {description.slice(0, 4000)}
        </ReactMarkdown>
      </div>
    )
  }

  if (type === 'TYPE_SCORM') {
    return <EmptyState text="SCORM package — preview unavailable" />
  }

  if (type === 'TYPE_CUSTOM') {
    return <EmptyState text="Custom activity — preview unavailable" />
  }

  return <EmptyState text="Preview unavailable for this activity type" />
}

// ──────────────────────────────────────────────────────────────────────────
// Public: inline preview
// ──────────────────────────────────────────────────────────────────────────

export default function ActivityPreview({
  activity,
  autoFetch = true,
  className,
}: ActivityPreviewProps) {
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  const hasInlineContent =
    activity?.content && Object.keys(activity.content).length > 0
  const [fetched, setFetched] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!autoFetch || hasInlineContent || fetched || loading) return
    if (!activity?.activity_uuid) return
    let cancelled = false
    setLoading(true)
    getActivity(activity.activity_uuid, null, accessToken || '')
      .then((res) => {
        if (cancelled) return
        if (res && !res.detail) {
          setFetched(res)
        } else {
          setError(res?.detail || 'Could not load activity')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Could not load activity')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [autoFetch, hasInlineContent, fetched, loading, activity?.activity_uuid, accessToken])

  // The caller's `activity` always wins so a draft passed in stays visible.
  const display = hasInlineContent ? activity : fetched

  return (
    <div className={className}>
      {loading && !display ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
          <Loader2 size={12} className="animate-spin" />
          Loading preview…
        </div>
      ) : error && !display ? (
        <EmptyState text={error} />
      ) : display ? (
        <PreviewBody activity={display} />
      ) : (
        <EmptyState text="No preview available" />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Public: hover-card wrapper
// ──────────────────────────────────────────────────────────────────────────

export type ActivityPreviewHoverCardProps = {
  activity: any
  children: React.ReactNode
}

export function ActivityPreviewHoverCard({
  activity,
  children,
}: ActivityPreviewHoverCardProps) {
  const [hasOpened, setHasOpened] = useState(false)

  return (
    <HoverCard
      openDelay={350}
      closeDelay={120}
      onOpenChange={(open) => {
        if (open) setHasOpened(true)
      }}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="right"
        sideOffset={8}
        className="w-[420px] max-w-[90vw] p-0 border border-gray-200 bg-white shadow-xl rounded-xl overflow-hidden"
      >
        {hasOpened ? (
          <ActivityPreview activity={activity} className="max-h-72 overflow-y-auto px-4 py-3" />
        ) : (
          <div className="max-h-72 px-4 py-3" />
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
