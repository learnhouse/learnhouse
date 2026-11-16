'use client'
import React from 'react'

// Podcast editor tab body: the same gutters as the course and path editors.
export function PodcastEditorPage({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-4 sm:px-10 pt-6 sm:pt-8 pb-16 ${className}`}>
      <div className="w-full space-y-5">{children}</div>
    </div>
  )
}

// Loading placeholder shaped like a stack of section cards.
export function PodcastEditorSkeleton({ sections = 2, rows = 3 }: { sections?: number; rows?: number }) {
  return (
    <div className="space-y-5 animate-pulse">
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl nice-shadow p-5 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-neutral-100 shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-40 rounded bg-neutral-200" />
              <div className="h-3 w-72 max-w-full rounded bg-neutral-100" />
            </div>
          </div>
          {Array.from({ length: rows }).map((__, j) => (
            <div key={j} className="space-y-2">
              <div className="h-3 w-24 rounded bg-neutral-200" />
              <div className="h-9 w-full rounded-lg bg-neutral-100" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
