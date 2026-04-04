'use client'
import React, { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { WarningCircle, ArrowClockwise, FloppyDisk, MarkdownLogo, SpinnerGap } from '@phosphor-icons/react'
import { updateActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import 'github-markdown-css/github-markdown-light.css'

function toRawUrl(url: string): string {
  // GitHub: github.com/user/repo/blob/branch/path -> raw.githubusercontent.com/user/repo/branch/path
  const ghMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/
  )
  if (ghMatch) {
    return `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`
  }
  // GitLab: gitlab.com/user/repo/-/blob/branch/path -> gitlab.com/user/repo/-/raw/branch/path
  const glMatch = url.match(/^(https?:\/\/gitlab\.com\/.+)\/-\/blob\/(.+)$/)
  if (glMatch) {
    return `${glMatch[1]}/-/raw/${glMatch[2]}`
  }
  // Bitbucket: bitbucket.org/user/repo/src/branch/path -> bitbucket.org/user/repo/raw/branch/path
  const bbMatch = url.match(
    /^(https?:\/\/bitbucket\.org\/[^/]+\/[^/]+)\/src\/(.+)$/
  )
  if (bbMatch) {
    return `${bbMatch[1]}/raw/${bbMatch[2]}`
  }
  return url
}

interface MarkdownActivityProps {
  activity: any
  editable?: boolean
  style?: React.CSSProperties
}

function MarkdownActivity({ activity, editable = false, style }: MarkdownActivityProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const markdownUrl = activity.content?.markdown_url || ''

  const [markdown, setMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable state
  const [editUrl, setEditUrl] = useState(markdownUrl)
  const [saving, setSaving] = useState(false)

  const fetchMarkdown = useCallback(async (url: string) => {
    if (!url) {
      setError('No markdown URL configured')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rawUrl = toRawUrl(url)
      const res = await fetch(rawUrl)
      if (!res.ok) {
        throw new Error(`Failed to fetch markdown (${res.status})`)
      }
      const text = await res.text()
      setMarkdown(text)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch markdown')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMarkdown(markdownUrl)
  }, [markdownUrl, fetchMarkdown])

  const handleSaveUrl = async () => {
    if (!editUrl.trim()) return
    setSaving(true)
    try {
      await updateActivity(
        { content: { markdown_url: editUrl.trim() } },
        activity.activity_uuid,
        access_token
      )
      toast.success('Markdown URL updated')
      fetchMarkdown(editUrl.trim())
    } catch {
      toast.error('Failed to update URL')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <SpinnerGap size={32} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">{error}</p>
        <button
          onClick={() => fetchMarkdown(markdownUrl)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowClockwise size={16} />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="w-full px-6 py-6" style={style}>
      {editable && (
        <div className="mb-6 flex items-center gap-3">
          <MarkdownLogo size={20} weight="duotone" className="text-rose-400 flex-shrink-0" />
          <input
            type="url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            placeholder="https://github.com/user/repo/blob/main/README.md"
            className="flex-1 h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
          />
          <button
            onClick={handleSaveUrl}
            disabled={saving || editUrl.trim() === markdownUrl}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {saving ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <FloppyDisk size={16} />
            )}
            Save
          </button>
        </div>
      )}

      <div className="markdown-body" style={style ? { backgroundColor: 'transparent', color: 'inherit' } : undefined}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight]}>
          {markdown || ''}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export default MarkdownActivity
