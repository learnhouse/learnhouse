'use client'

import React, { lazy, Suspense, useMemo, useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ExternalLink, Layers, AlertCircle, Info, AlertTriangle, CheckCircle, Lightbulb, Share2, Check, Copy, Users, BookOpen } from 'lucide-react'
import { Breadcrumbs, BreadcrumbItem } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import useSWR from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'

const DiscussionList = lazy(() => import('@components/Objects/Communities/DiscussionList'))
const DynamicCanva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))

interface DocPageViewProps {
  page: any
  sectionName?: string
  subpages?: any[]
  breadcrumbItems?: BreadcrumbItem[]
}

interface TocItem {
  id: string
  text: string
  level: number
}

const DocPageView = ({ page, sectionName, subpages, breadcrumbItems }: DocPageViewProps) => {
  if (!page) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p>Page content not available.</p>
      </div>
    )
  }

  const content = page.content || {}
  const isRichContent = page.page_type === 'MARKDOWN' && (content.tiptapContent || content.markdown)
  const resolvedSubpages = subpages || page.subpages || []

  return (
    <article className="w-full">
      {breadcrumbItems && breadcrumbItems.length > 0 && (
        <div className="pb-4">
          <Breadcrumbs items={breadcrumbItems} />
        </div>
      )}
      <div className="flex">
        {/* Main content */}
        <div className={`relative min-w-0 bg-white rounded-xl nice-shadow p-6 sm:p-10 ${isRichContent ? 'flex-1' : 'w-full'}`}>
          {isRichContent && (
            <CopyMarkdownButton content={content} />
          )}
          {sectionName && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
              {sectionName}
            </p>
          )}
          <h1 className="text-3xl font-bold text-gray-900 mb-6">{page.name}</h1>
          <PageContent page={page} />

          {/* Subpage tabs for pages with subpages */}
          {resolvedSubpages.length > 0 && (
            <SubpageTabs subpages={resolvedSubpages} />
          )}
        </div>

        {/* On this page sidebar */}
        {isRichContent && (
          <OnThisPage content={content} />
        )}
      </div>
    </article>
  )
}

/* ─── Copy Markdown Button ─── */

function extractTextFromTiptap(tiptapContent: any): string {
  if (!tiptapContent?.content) return ''
  const lines: string[] = []
  for (const node of tiptapContent.content) {
    const text = node.content?.map((c: any) => c.text || '').join('') || ''
    if (node.type === 'heading' && node.attrs?.level) {
      lines.push('#'.repeat(node.attrs.level) + ' ' + text)
    } else {
      lines.push(text)
    }
  }
  return lines.join('\n\n')
}

const CopyMarkdownButton = ({ content }: { content: any }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = content.markdown || extractTextFromTiptap(content.tiptapContent)
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      title="Copy markdown"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

/* ─── On This Page Sidebar ─── */

function extractHeadingsFromTiptap(tiptapContent: any): TocItem[] {
  const headings: TocItem[] = []
  if (!tiptapContent?.content) return headings

  for (const node of tiptapContent.content) {
    if (node.type === 'heading' && node.attrs?.level) {
      const text = node.content?.map((c: any) => c.text || '').join('') || ''
      if (text) {
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        headings.push({ id, text, level: node.attrs.level })
      }
    }
  }
  return headings
}

function extractHeadingsFromMarkdown(markdown: string): TocItem[] {
  const headings: TocItem[] = []
  const lines = markdown.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2].replace(/[*_`~\[\]]/g, '').trim()
      if (text) {
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        headings.push({ id, text, level })
      }
    }
  }
  return headings
}

const OnThisPage = ({ content }: { content: any }) => {
  const [activeId, setActiveId] = useState<string>('')

  const headings = useMemo(() => {
    if (content.tiptapContent) {
      return extractHeadingsFromTiptap(content.tiptapContent)
    }
    if (content.markdown) {
      return extractHeadingsFromMarkdown(content.markdown)
    }
    return []
  }, [content])

  const handleScroll = useCallback(() => {
    const headingElements = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[]

    let current = ''
    for (const el of headingElements) {
      if (el.getBoundingClientRect().top <= 100) {
        current = el.id
      }
    }
    setActiveId(current)
  }, [headings])

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const [copied, setCopied] = useState(false)

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (headings.length < 2) return null

  return (
    <nav className="hidden xl:block w-[20%] flex-shrink-0 pl-8">
      <div className="sticky top-24">
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors mb-4"
        >
          {copied ? <Check size={13} /> : <Share2 size={13} />}
          {copied ? 'Link copied!' : 'Share'}
        </button>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          On this page
        </p>
        <ul className="space-y-1 border-l border-gray-200">
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' })
                }}
                className={`block text-[13px] leading-snug py-1 transition-colors border-l -ml-px ${
                  heading.level === 1 ? 'pl-3' : ''
                }${heading.level === 2 ? 'pl-3' : ''}${
                  heading.level === 3 ? 'pl-6' : ''
                }${heading.level === 4 ? 'pl-9' : ''} ${
                  activeId === heading.id
                    ? 'text-gray-900 font-medium border-gray-900'
                    : 'text-gray-500 hover:text-gray-700 border-transparent'
                }`}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

const PageContent = ({ page }: { page: any }) => {
  const content = page.content || {}

  switch (page.page_type) {
    case 'MARKDOWN':
      if (content.tiptapContent) {
        return <TiptapContent content={content.tiptapContent} />
      }
      return <MarkdownContent markdown={content.markdown || ''} />
    case 'LINK':
      return <LinkContent content={content} />
    case 'EMBED':
      return <EmbedContent content={content} />
    case 'COURSE_ACTIVITY':
      return <CourseActivityContent content={content} />
    case 'NOCODE':
      return <NoCodeContent content={content} />
    case 'COMMUNITY':
      return <CommunityContent content={content} />
    default:
      return (
        <div className="text-gray-400 text-sm">
          Unknown page type: {page.page_type}
        </div>
      )
  }
}

/* ─── Markdown ─── */

const MarkdownContent = ({ markdown }: { markdown: string }) => {
  if (!markdown) {
    return (
      <div className="text-gray-400 text-sm italic">No content yet.</div>
    )
  }

  return (
    <div className="doc-tiptap-rendered">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children, ...props }) => {
            const text = extractTextFromChildren(children)
            const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            return <h1 id={id} {...props}>{children}</h1>
          },
          h2: ({ children, ...props }) => {
            const text = extractTextFromChildren(children)
            const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            return <h2 id={id} {...props}>{children}</h2>
          },
          h3: ({ children, ...props }) => {
            const text = extractTextFromChildren(children)
            const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            return <h3 id={id} {...props}>{children}</h3>
          },
          h4: ({ children, ...props }) => {
            const text = extractTextFromChildren(children)
            const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            return <h4 id={id} {...props}>{children}</h4>
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('')
  if (React.isValidElement(children)) {
    const props = children.props as Record<string, any>
    if (props?.children) {
      return extractTextFromChildren(props.children)
    }
  }
  return ''
}

/* ─── Tiptap Content ─── */

const calloutVariantStyles: Record<string, { icon: React.ReactNode; bg: string; border: string; iconColor: string }> = {
  info: { icon: <Info size={16} />, bg: 'bg-blue-50', border: 'border-blue-400', iconColor: 'text-blue-500' },
  warning: { icon: <AlertTriangle size={16} />, bg: 'bg-amber-50', border: 'border-amber-400', iconColor: 'text-amber-500' },
  success: { icon: <CheckCircle size={16} />, bg: 'bg-green-50', border: 'border-green-400', iconColor: 'text-green-500' },
  tip: { icon: <Lightbulb size={16} />, bg: 'bg-purple-50', border: 'border-purple-400', iconColor: 'text-purple-500' },
}

const tiptapExtensions = [
  StarterKit,
  Link,
  Table,
  TableRow,
  TableCell,
  TableHeader,
]

function addHeadingIds(html: string): string {
  return html.replace(
    /<(h[1-4])>(.*?)<\/\1>/g,
    (_match, tag, content) => {
      const text = content.replace(/<[^>]*>/g, '')
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return `<${tag} id="${id}">${content}</${tag}>`
    }
  )
}

const TiptapContent = ({ content }: { content: any }) => {
  const { segments } = useMemo(() => {
    if (!content?.content) return { segments: [] }

    const segs: Array<{ type: 'html'; html: string } | { type: 'callout'; variant: string; text: string } | { type: 'image'; src: string; alt: string; title: string }> = []
    let htmlBatch: any[] = []

    const flushHtmlBatch = () => {
      if (htmlBatch.length > 0) {
        try {
          const html = generateHTML({ type: 'doc', content: htmlBatch }, tiptapExtensions)
          segs.push({ type: 'html', html: addHeadingIds(html) })
        } catch {
          // skip
        }
        htmlBatch = []
      }
    }

    for (const node of content.content) {
      if (node.type === 'docCallout') {
        flushHtmlBatch()
        const text = node.content?.map((c: any) => c.text || '').join('') || ''
        segs.push({ type: 'callout', variant: node.attrs?.variant || 'info', text })
      } else if (node.type === 'docImage') {
        flushHtmlBatch()
        segs.push({ type: 'image', src: node.attrs?.src || '', alt: node.attrs?.alt || '', title: node.attrs?.title || '' })
      } else {
        htmlBatch.push(node)
      }
    }
    flushHtmlBatch()

    return { segments: segs }
  }, [content])

  return (
    <div className="doc-tiptap-rendered">
      {segments.map((seg, i) => {
        if (seg.type === 'html') {
          return (
            <div
              key={i}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          )
        }
        if (seg.type === 'callout') {
          const style = calloutVariantStyles[seg.variant] || calloutVariantStyles.info
          return (
            <div key={i} className={`flex items-start gap-3 rounded-lg border-l-4 p-4 my-3 ${style.bg} ${style.border}`}>
              <span className={`mt-0.5 flex-shrink-0 ${style.iconColor}`}>{style.icon}</span>
              <p className="text-sm leading-relaxed text-gray-700">{seg.text}</p>
            </div>
          )
        }
        if (seg.type === 'image') {
          if (!seg.src) return null
          return (
            <div key={i} className="my-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={seg.src} alt={seg.alt || ''} title={seg.title || ''} className="rounded-lg max-w-full" />
              {seg.alt && <p className="text-xs text-gray-500 text-center mt-1">{seg.alt}</p>}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

/* ─── Link ─── */

const LinkContent = ({ content }: { content: any }) => {
  const url = content?.url
  if (!url) {
    return <div className="text-gray-400 text-sm italic">No link configured.</div>
  }

  return (
    <div className="border rounded-lg p-6 bg-gray-50">
      <div className="flex items-center gap-3">
        <ExternalLink size={20} className="text-blue-500" />
        <div>
          <a
            href={url}
            target={content.open_in_new_tab ? '_blank' : undefined}
            rel={content.open_in_new_tab ? 'noopener noreferrer' : undefined}
            className="text-blue-600 hover:text-blue-800 font-medium text-lg underline"
          >
            {url}
          </a>
          <p className="text-sm text-gray-500 mt-1">
            {content.open_in_new_tab ? 'Opens in a new tab' : 'Opens in the same tab'}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Embed ─── */

const EmbedContent = ({ content }: { content: any }) => {
  const embedUrl = content?.embed_url
  if (!embedUrl) {
    return <div className="text-gray-400 text-sm italic">No embed configured.</div>
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <iframe
        src={embedUrl}
        width="100%"
        height={content?.height || 600}
        className="border-0"
        title="Embedded content"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  )
}

/* ─── Course Activity ─── */

const ActivityLoadingFallback = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" />
  </div>
)

const ActivityErrorFallback = () => (
  <div className="border rounded-lg p-6 bg-gray-50 flex items-center gap-3">
    <AlertCircle size={20} className="text-gray-400" />
    <div>
      <p className="font-medium text-gray-600 text-sm">Activity not available</p>
      <p className="text-xs text-gray-400 mt-0.5">
        This activity may have been removed or you don&apos;t have access to it.
      </p>
    </div>
  </div>
)

const CourseActivityContent = ({ content }: { content: any }) => {
  const activityUuid = content?.activity_uuid
  const courseUuid = content?.course_uuid
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data: activity, error: activityError } = useSWR(
    activityUuid ? `${getAPIUrl()}activities/${activityUuid}` : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const { data: course } = useSWR(
    courseUuid ? `${getAPIUrl()}courses/course_${courseUuid}/meta` : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  if (!activityUuid) {
    return <div className="text-gray-400 text-sm italic">No activity linked.</div>
  }

  if (activityError) {
    return <ActivityErrorFallback />
  }

  if (!activity) {
    return <ActivityLoadingFallback />
  }

  switch (activity.activity_type) {
    case 'TYPE_DYNAMIC':
      return (
        <Suspense fallback={<ActivityLoadingFallback />}>
          <DynamicCanva content={activity.content} activity={activity} />
        </Suspense>
      )
    case 'TYPE_VIDEO':
      return (
        <Suspense fallback={<ActivityLoadingFallback />}>
          <VideoActivity course={course || { course_uuid: courseUuid }} activity={activity} />
        </Suspense>
      )
    case 'TYPE_DOCUMENT':
      return (
        <Suspense fallback={<ActivityLoadingFallback />}>
          <DocumentPdfActivity course={course || { course_uuid: courseUuid }} activity={activity} />
        </Suspense>
      )
    default:
      return (
        <div className="border rounded-lg p-6 bg-gray-50">
          <div className="flex items-center gap-3">
            <Layers size={20} className="text-orange-500" />
            <div>
              <p className="font-medium text-gray-700">{activity.name}</p>
              <p className="text-sm text-gray-400 mt-1">
                This activity type cannot be previewed inline.
              </p>
            </div>
          </div>
        </div>
      )
  }
}

/* ─── NoCode (Placeholder Renderer) ─── */

const NoCodeContent = ({ content }: { content: any }) => {
  const blocks = content?.blocks || []

  if (blocks.length === 0) {
    return <div className="text-gray-400 text-sm italic">No content yet.</div>
  }

  return (
    <div className="space-y-4">
      {blocks.map((block: any, index: number) => (
        <NoCodeBlock key={index} block={block} />
      ))}
    </div>
  )
}

const NoCodeBlock = ({ block }: { block: any }) => {
  switch (block.type) {
    case 'text':
      return (
        <div className="prose prose-gray max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {block.content || ''}
          </ReactMarkdown>
        </div>
      )
    case 'image':
      return (
        <div className="my-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.src}
            alt={block.alt || ''}
            className="rounded-lg max-w-full"
          />
          {block.caption && (
            <p className="text-sm text-gray-500 text-center mt-2">{block.caption}</p>
          )}
        </div>
      )
    case 'code':
      return (
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto">
          <code>{block.content || ''}</code>
        </pre>
      )
    case 'callout':
      return (
        <div className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg">
          <p className="text-sm text-blue-800">{block.content || ''}</p>
        </div>
      )
    case 'divider':
      return <hr className="border-gray-200 my-6" />
    case 'spacer':
      return <div style={{ height: block.height || 40 }} />
    default:
      return null
  }
}

/* ─── Community ─── */

const CommunityContent = ({ content }: { content: any }) => {
  const params = useParams()
  const orgslug = params?.orgslug as string
  const communityUuid = content?.community_uuid

  if (!communityUuid) {
    return (
      <div className="border rounded-lg p-6 bg-gray-50 flex items-center gap-3">
        <Users size={20} className="text-gray-400" />
        <div>
          <p className="font-medium text-gray-600 text-sm">No community linked</p>
          <p className="text-xs text-gray-400 mt-0.5">
            This page has not been linked to a community yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg overflow-hidden border">
      <Suspense fallback={<ActivityLoadingFallback />}>
        <DiscussionList
          communityUuid={communityUuid}
          orgslug={orgslug}
        />
      </Suspense>
    </div>
  )
}

/* ─── Subpage Tabs (inline rendering for API endpoint children) ─── */

const SubpageTabs = ({ subpages }: { subpages: any[] }) => {
  const [activeTab, setActiveTab] = useState(0)
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  // Fetch full content for the active subpage
  const activeSubpage = subpages[activeTab]
  const { data: fullSubpage } = useSWR(
    activeSubpage?.docpage_uuid
      ? `${getAPIUrl()}docs/pages/${activeSubpage.docpage_uuid}`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  return (
    <div className="mt-8 border-t pt-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-6">
        {subpages.map((sub: any, i: number) => (
          <button
            key={sub.docpage_uuid}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              i === activeTab
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {sub.name}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {fullSubpage ? (
        <PageContent page={fullSubpage} />
      ) : (
        <div className="text-gray-400 text-sm py-4">Loading...</div>
      )}
    </div>
  )
}

export default DocPageView
