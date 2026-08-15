'use client'

import React, { useEffect, useState } from 'react'
import { Sparkle, CircleNotch } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { DemoStatus, enterDemo, getDemoStatus } from '@services/demo/demo'

/**
 * Human wording for the refresh interval.
 *
 * Pluralises off the rounded number rather than the raw minutes: the previous
 * version keyed the "s" on `minutes >= 120`, so a 90-minute interval rounded to
 * 2 and then printed "2 hour".
 */
function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }
  const hours = Math.round(minutes / 60)
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/**
 * "Explore a live demo" — a side path into the shared demo organization.
 *
 * Renders nothing when the instance has no demo, so it can be dropped onto any
 * page without a guard. It never blocks what it sits next to: the status call
 * failing simply hides the card rather than breaking org creation.
 */
export default function DemoEntryCard({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [entering, setEntering] = useState(false)

  useEffect(() => {
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (poll) {
        clearInterval(poll)
        poll = null
      }
    }

    const load = () =>
      getDemoStatus().then((result) => {
        if (cancelled) return
        setStatus(result)
        // Stop once there is nothing left to wait for. Reading the status once
        // meant a visitor who arrived while the demo was still being built was
        // left looking at a permanently disabled button until they reloaded.
        //
        // "Ready" is not the only terminal state: getDemoStatus answers null on
        // a network error and enabled:false on an instance with no demo at all,
        // and polling either of those every five seconds for the life of the
        // page buys nothing — the card renders nothing in both cases.
        if (!result || !result.enabled || result.ready) {
          stop()
        }
      })

    // Interval first: the initial read usually settles the question, and if it
    // ran before `poll` existed its stop() would be a no-op and the timer would
    // start anyway.
    poll = setInterval(load, 5_000)
    load()

    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
    }
  }, [])

  if (!status?.enabled) return null

  const handleEnter = async () => {
    if (entering) return
    setEntering(true)
    try {
      const result = await enterDemo(session?.data?.tokens?.access_token)
      // Full navigation rather than a client push: the demo lives on its own
      // org path, and the session's roles were just invalidated server-side.
      window.location.href = getUriWithOrg(result.org_slug, '/dash')
    } catch {
      toast.error(
        t('demo.entry_busy', {
          defaultValue: 'The demo is being refreshed. Try again in a moment.',
        })
      )
      setEntering(false)
    }
  }

  const disabled = entering || !status.ready

  return (
    <button
      type="button"
      onClick={handleEnter}
      disabled={disabled}
      className={`w-full text-start rounded-2xl border border-dashed border-gray-300 bg-white p-5 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white">
          {entering ? (
            <CircleNotch size={18} weight="bold" className="animate-spin" />
          ) : (
            <Sparkle size={18} weight="fill" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {entering
              ? t('demo.entry_opening', { defaultValue: 'Opening the demo…' })
              : t('demo.entry_title', { defaultValue: 'Explore a live demo' })}
          </p>
          <p className="mt-1 text-sm leading-snug text-gray-500">
            {t('demo.entry_body', {
              interval: formatInterval(status.refresh_minutes),
              defaultValue:
                'A full academy with courses, learners, progress and grading — already filled in. Shared with everyone, and reset every {{interval}}.',
            })}
          </p>
          {!status.ready && (
            <p className="mt-2 text-xs font-medium text-gray-400">
              {t('demo.entry_preparing', {
                defaultValue: 'Being prepared — try again in a moment.',
              })}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}
