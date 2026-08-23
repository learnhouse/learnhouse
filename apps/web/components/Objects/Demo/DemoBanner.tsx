'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Sparkle } from '@phosphor-icons/react'

import { useOrg } from '@components/Contexts/OrgContext'
import { isMultiOrgModeEnabled } from '@services/config/config'
import { DemoStatus, getDemoStatus } from '@services/demo/demo'

function formatCountdown(
  target: string | null,
  imminent: string
): string | null {
  if (!target) return null
  const remaining = new Date(target).getTime() - Date.now()
  if (Number.isNaN(remaining)) return null
  if (remaining <= 0) return imminent
  const totalSeconds = Math.floor(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/**
 * Tells a visitor they are in the shared demo, and when it resets.
 *
 * Renders nothing outside a demo organization. The countdown is honest about
 * what is coming: everything a visitor changes here is put back, and saying so
 * up front is better than them losing work they thought they had saved.
 */
export default function DemoBanner() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [countdown, setCountdown] = useState<string | null>(null)

  const isDemo = Boolean(org?.is_demo)

  useEffect(() => {
    if (!isDemo) return
    let cancelled = false

    const load = () =>
      getDemoStatus().then((result) => {
        if (!cancelled) setStatus(result)
      })

    load()
    // Re-read the schedule periodically. Fetching once meant the countdown ran
    // to zero at the first reset and then sat on "any moment" forever, because
    // next_refresh_at never moved — the banner would spend most of a session
    // telling a visitor a reset was imminent.
    const poll = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [isDemo])

  const imminent = t('demo.reset_imminent', { defaultValue: 'any moment' })

  useEffect(() => {
    if (!status?.next_refresh_at) return
    const tick = () =>
      setCountdown(formatCountdown(status.next_refresh_at, imminent))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [status?.next_refresh_at, imminent])

  if (!isDemo) return null

  return (
    // In normal flow, deliberately. Two out-of-flow variants were tried and
    // both covered controls: pinned to the bottom it sat over the editor's save
    // bar and the mobile menu (which the dash reserves pb-24 for), and pinned to
    // the top it sat over page headers while the fixed left menu — a sibling at
    // a higher stacking level — painted over its own first 256px.
    //
    // The cost of staying in flow is that dash pages which set h-screen and
    // manage their own inner scrolling become taller than the viewport by this
    // strip's height, so the page gains an outer scrollbar. That is a visual
    // blemish on a demo; covering the save button is lost work.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <Sparkle size={16} weight="fill" className="shrink-0" />
      <span className="font-semibold">
        {t('demo.banner_title', { defaultValue: 'You are in the shared demo.' })}
      </span>
      <span className="text-amber-800">
        {countdown
          ? t('demo.banner_body_countdown', {
              countdown,
              defaultValue:
                'Everything here is example data, and anything you change is put back in {{countdown}}.',
            })
          : t('demo.banner_body', {
              defaultValue:
                'Everything here is example data, and anything you change is put back regularly.',
            })}
      </span>
      {/* The hub only exists in multi-tenancy; on a single-org install /new is
          a 404, so the call to action is simply not offered there. */}
      {isMultiOrgModeEnabled() && (
        <Link
          href="/new"
          className="ms-auto shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
        >
          {t('demo.create_your_own', {
            defaultValue: 'Create your own organization',
          })}
        </Link>
      )}
    </div>
  )
}
