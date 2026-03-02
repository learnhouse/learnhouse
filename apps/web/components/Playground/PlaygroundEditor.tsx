'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion, type Transition, type TargetAndTransition } from 'motion/react'
import {
  ArrowLeft,
  Globe,
  Check,
  FloppyDisk,
  Eye,
  EyeSlash,
  SlidersHorizontal,
  ArrowSquareOut,
  PencilSimple,
  CircleNotch,
} from '@phosphor-icons/react'
import { SlashIcon, DividerVerticalIcon } from '@radix-ui/react-icons'
import PlaygroundPreview from './PlaygroundPreview'
import PlaygroundChatPanel from './PlaygroundChatPanel'
import PlaygroundOptionsModal from './PlaygroundOptionsModal'
import { startPlaygroundSession, iteratePlayground } from '@services/playgrounds/generator'
import { updatePlayground, Playground } from '@services/playgrounds/playgrounds'

interface Course {
  course_uuid: string
  name: string
}

interface PlaygroundEditorProps {
  playground: Playground
  orgslug: string
  accessToken: string
  orgCourses?: Course[]
}

type Message = { role: 'user' | 'model'; content: string }

const logoAnimations: { initial: TargetAndTransition; animate: TargetAndTransition; transition: Transition }[] = [
  {
    initial: { y: 10, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { duration: 0.4, ease: 'easeOut' as const },
  },
  {
    initial: { x: -10, opacity: 0 },
    animate: { x: 0, opacity: 1 },
    transition: { duration: 0.4, ease: 'easeOut' as const },
  },
  {
    initial: { scale: 0.7, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: { duration: 0.35, ease: 'easeOut' as const },
  },
]

const EditorLearnHouseLogo = () => {
  const [animation] = useState(
    () => logoAnimations[Math.floor(Math.random() * logoAnimations.length)]
  )
  return (
    <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center overflow-hidden flex-shrink-0">
      <motion.div
        initial={animation.initial}
        animate={animation.animate}
        transition={animation.transition}
      >
        <Image src="/lrn.svg" alt="LearnHouse" width={14} height={14} className="invert" />
      </motion.div>
    </div>
  )
}

export default function PlaygroundEditor({
  playground: initialPlayground,
  orgslug,
  accessToken,
  orgCourses = [],
}: PlaygroundEditorProps) {
  const [playground, setPlayground] = useState(initialPlayground)
  const [title, setTitle] = useState(initialPlayground.name)
  const [html, setHtml] = useState<string>(initialPlayground.html_content || '')
  const [streamingHtml, setStreamingHtml] = useState<string>('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionUuid, setSessionUuid] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [iterationCount, setIterationCount] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedCourseUuid, setSelectedCourseUuid] = useState<string>('')
  const [titleFocused, setTitleFocused] = useState(false)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const [titleSaveStatus, setTitleSaveStatus] = useState<'idle' | 'saved'>('idle')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const toggleFullscreen = () => setIsFullscreen((f) => !f)
  const MAX_ITERATIONS = 10

  const titleDirty = title !== playground.name

  const selectedCourse = orgCourses.find((c) => c.course_uuid === selectedCourseUuid) || null

  // Auto-save title on blur
  const handleTitleBlur = useCallback(async () => {
    setTitleFocused(false)
    const trimmed = title.trim()
    if (!trimmed || trimmed === playground.name) return
    setIsSavingTitle(true)
    try {
      const updated = await updatePlayground(playground.playground_uuid, { name: trimmed }, accessToken)
      setPlayground(updated)
      setTitle(updated.name)
      setTitleSaveStatus('saved')
      setTimeout(() => setTitleSaveStatus('idle'), 2000)
    } catch {
      // revert on error
      setTitle(playground.name)
    } finally {
      setIsSavingTitle(false)
    }
  }, [title, playground, accessToken])

  // Reset title dirty state when playground updates externally (e.g. via modal)
  useEffect(() => {
    setTitle(playground.name)
  }, [playground.name])

  // Keep title in sync if playground name changes via modal
  const handleUpdated = (updated: Playground) => {
    setPlayground(updated)
    setTitle(updated.name)
  }

  const handleSend = useCallback(
    async (prompt: string) => {
      if (isStreaming) return

      setIsStreaming(true)
      setStreamingHtml('')
      setMessages((prev) => [...prev, { role: 'user' as const, content: prompt }])

      let accumulated = ''

      const onChunk = (chunk: string) => {
        accumulated += chunk
        setStreamingHtml(accumulated)
      }

      const onComplete = (uuid: string) => {
        setSessionUuid(uuid)
        setIsStreaming(false)
        setIterationCount((c) => c + 1)
        setHtml(accumulated)
        setStreamingHtml('')
        setMessages((prev) => [...prev, { role: 'model' as const, content: accumulated }])
      }

      const onError = (_error: string) => {
        setIsStreaming(false)
        setStreamingHtml('')
        setMessages((prev) => prev.slice(0, -1))
      }

      if (!sessionUuid) {
        await startPlaygroundSession(
          playground.playground_uuid,
          prompt,
          {
            playground_name: title,
            playground_description: playground.description || '',
            course_uuid: selectedCourseUuid || undefined,
            course_name: selectedCourse?.name || undefined,
          },
          accessToken,
          onChunk,
          onComplete,
          onError
        )
      } else {
        await iteratePlayground(
          sessionUuid,
          playground.playground_uuid,
          prompt,
          accessToken,
          onChunk,
          onComplete,
          onError,
          html
        )
      }
    },
    [isStreaming, sessionUuid, playground, title, html, accessToken, selectedCourseUuid, selectedCourse]
  )

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updated = await updatePlayground(
        playground.playground_uuid,
        {
          name: title,
          html_content: html || undefined,
        },
        accessToken
      )
      handleUpdated(updated)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handlePublishToggle = async () => {
    try {
      const updated = await updatePlayground(
        playground.playground_uuid,
        { published: !playground.published },
        accessToken
      )
      handleUpdated(updated)
    } catch (err) {
      console.error('Publish toggle failed:', err)
    }
  }

  const previewHtml = isStreaming ? streamingHtml : html

  return (
    <div className="activity-editor-page flex flex-col" style={{ paddingTop: 0 }}>
      {/* ── Toolbar ── */}
      <div
        style={{
          borderRadius: 15,
          margin: '20px 40px 16px',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 6px -1px rgba(209,213,219,0.25), 0 2px 4px -2px rgba(209,213,219,0.25)',
          outline: '1px solid rgba(229,231,235,0.5)',
          zIndex: 40,
        }}
      >
        {/* Logo */}
        <Link href="/">
          <EditorLearnHouseLogo />
        </Link>

        <SlashIcon style={{ color: '#d1d5db', flexShrink: 0 }} />

        {/* Back */}
        <Link
          href="/playgrounds"
          className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-700 transition-colors flex-shrink-0 font-medium"
        >
          <ArrowLeft size={14} weight="bold" />
          <span>Playgrounds</span>
        </Link>

        <SlashIcon style={{ color: '#d1d5db', flexShrink: 0 }} />

        {/* Editable title */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0 group">
          <div className={`flex-1 flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all min-w-0 ${
            titleFocused
              ? 'bg-gray-100 ring-1 ring-gray-300'
              : 'hover:bg-gray-50'
          }`}>
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setTitleFocused(true)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') titleInputRef.current?.blur() }}
              className="flex-1 text-sm font-semibold text-gray-800 bg-transparent border-0 outline-none focus:ring-0 min-w-0"
              placeholder="Playground title"
            />
            {!titleFocused && !isSavingTitle && (
              <PencilSimple
                size={11}
                weight="bold"
                className="text-gray-300 group-hover:text-gray-400 flex-shrink-0 transition-colors cursor-pointer"
                onClick={() => titleInputRef.current?.focus()}
              />
            )}
          </div>

          {/* Title status indicators */}
          {isSavingTitle && (
            <CircleNotch size={12} weight="bold" className="animate-spin text-gray-400 flex-shrink-0" />
          )}
          {titleSaveStatus === 'saved' && !isSavingTitle && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-500 flex-shrink-0">
              <Check size={10} weight="bold" />
              Saved
            </span>
          )}
          {titleDirty && !titleFocused && !isSavingTitle && titleSaveStatus === 'idle' && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved name change" />
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* Options */}
          <button
            onClick={() => setOptionsOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3 py-2 font-black text-sm nice-shadow rounded-lg transition-all ease-linear hover:cursor-pointer bg-neutral-100 hover:bg-neutral-200 text-neutral-600"
          >
            <SlidersHorizontal size={14} weight="bold" />
            Options
          </button>

          <DividerVerticalIcon style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey', opacity: 0.5 }} />

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-1.5 h-9 px-3 py-2 font-black text-sm nice-shadow rounded-lg transition-all ease-linear hover:cursor-pointer disabled:opacity-50 ${
              saveStatus === 'saved'
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-sky-600 hover:bg-sky-700 text-white'
            }`}
          >
            {saveStatus === 'saved' ? (
              <><Check size={14} weight="bold" />Saved</>
            ) : (
              <><FloppyDisk size={14} weight="bold" />Save</>
            )}
          </button>

          {/* Publish */}
          <button
            onClick={handlePublishToggle}
            className={`flex items-center gap-1.5 h-9 px-3 py-2 font-black text-sm nice-shadow rounded-lg transition-all ease-linear hover:cursor-pointer ${
              playground.published
                ? 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600'
                : 'bg-neutral-600 hover:bg-neutral-700 text-neutral-100'
            }`}
          >
            {playground.published ? (
              <><Eye size={14} weight="bold" />Published</>
            ) : (
              <><EyeSlash size={14} weight="bold" />Publish</>
            )}
          </button>

          {/* Preview */}
          <Link
            href={`/playground/${playground.playground_uuid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 h-9 px-3 py-2 font-black text-sm nice-shadow rounded-lg transition-all ease-linear bg-neutral-100 hover:bg-neutral-200 text-neutral-600"
          >
            <ArrowSquareOut size={14} weight="bold" />
            Preview
          </Link>
        </div>
      </div>

      {/* ── Main split panel ── */}
      <div
        style={{
          margin: '0 40px 20px',
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          borderRadius: 15,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 6px -1px rgba(209,213,219,0.25), 0 2px 4px -2px rgba(209,213,219,0.25)',
          outline: '1px solid rgba(229,231,235,0.5)',
          minHeight: 'calc(100vh - 120px)',
        }}
      >
        {/* Preview — takes all space in fullscreen */}
        <div
          className="flex-1 flex overflow-hidden"
          style={{ borderRight: isFullscreen ? 'none' : '1px solid rgba(229,231,235,0.8)' }}
        >
          <PlaygroundPreview
            html={previewHtml || null}
            isStreaming={isStreaming}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>

        {/* Chat panel — hidden in fullscreen */}
        {!isFullscreen && (
          <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: 320 }}>
            <PlaygroundChatPanel
              messages={messages}
              isGenerating={isStreaming}
              iterationCount={iterationCount}
              maxIterations={MAX_ITERATIONS}
              onSend={handleSend}
              disabled={false}
              orgCourses={orgCourses}
              selectedCourseUuid={selectedCourseUuid}
              onCourseChange={setSelectedCourseUuid}
              sessionStarted={sessionUuid !== null}
            />
          </div>
        )}
      </div>

      {/* Options modal */}
      <PlaygroundOptionsModal
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        playground={playground}
        orgslug={orgslug}
        onUpdated={handleUpdated}
      />
    </div>
  )
}
