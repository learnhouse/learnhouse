'use client'

import React from 'react'

import { AlertTriangle, RotateCcw, X as XIcon } from 'lucide-react'

// Structured error card. Replaces the old "append italic text to message
// content" pattern. Carries the error code, the human message, and a
// retry button when the backend flagged the error as retriable
// (rate_limited, upstream_unavailable, internal_error mid-stream, etc.).

interface Props {
  code: string
  message: string
  retriable?: boolean
  onRetry?: () => void
  onDismiss?: () => void
}

export default function ErrorCard({ code, message, retriable, onRetry, onDismiss }: Props) {
  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-rose-400/30 bg-rose-500/10 overflow-hidden">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <AlertTriangle size={16} className="text-rose-300 mt-0.5 flex-none" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-rose-200/80 font-mono">
              {code}
            </span>
            {retriable && (
              <span className="text-[10px] uppercase tracking-wider text-amber-200/80 font-semibold">
                · retriable
              </span>
            )}
          </div>
          <div className="text-sm text-rose-100 leading-relaxed">{message}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex-none p-1 text-rose-300/60 hover:text-rose-100 transition-colors"
          >
            <XIcon size={13} />
          </button>
        )}
      </div>
      {retriable && onRetry && (
        <div className="border-t border-rose-400/20 bg-rose-500/5 px-4 py-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 bg-rose-500/20 hover:bg-rose-500/30 ring-1 ring-inset ring-rose-400/30 text-rose-100 rounded-lg px-3 py-1 text-xs font-semibold transition-colors"
          >
            <RotateCcw size={12} />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
