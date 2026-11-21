'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Lightbulb, X } from '@phosphor-icons/react'
import { Button } from '@/design'

// "Why peer review works": a short, dismissible card shown when peer review
// is on. Dismissal is remembered per user in this browser.

const storageKey = (userKey: string) => `lh:peer-review:why-dismissed:${userKey}`

function readDismissed(userKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userKey)) === '1'
  } catch {
    return false
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

export default function WhyPeerReviewCard({ userKey }: { userKey: string }) {
  const { t } = useTranslation()
  // Hidden on the server and until storage is read, so a dismissed card never flashes.
  const stored = React.useSyncExternalStore(
    subscribe,
    () => readDismissed(userKey),
    () => true
  )
  const [hiddenNow, setHiddenNow] = React.useState(false)

  if (stored || hiddenNow) return null

  const dismiss = () => {
    setHiddenNow(true)
    try {
      window.localStorage.setItem(storageKey(userKey), '1')
    } catch {
      // Storage blocked: the card just comes back next visit.
    }
  }

  const points = ['reviewers_learn', 'three_reviewers', 'rubric_practice', 'revise'] as const

  return (
    <section className='relative rounded-2xl bg-sky-50/70 ring-1 ring-inset ring-sky-600/10 p-5'>
      <Button
        variant='ghost'
        size='icon'
        onClick={dismiss}
        aria-label={t('peer_review.instructor.why.dismiss')}
        title={t('peer_review.instructor.why.dismiss')}
        className='absolute top-3 end-3'
      >
        <X size={14} />
      </Button>
      <div className='flex items-start gap-3 pe-8'>
        <div className='w-9 h-9 rounded-xl bg-white text-sky-600 flex items-center justify-center shrink-0 nice-shadow'>
          <Lightbulb size={18} weight='duotone' />
        </div>
        <div className='min-w-0'>
          <h2 className='text-base font-semibold text-neutral-900 leading-tight'>{t('peer_review.instructor.why.title')}</h2>
          <ul className='mt-2.5 flex flex-col gap-1.5 text-sm text-neutral-700'>
            {points.map((key) => (
              <li key={key} className='flex items-start gap-2'>
                <span className='mt-2 w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0' aria-hidden='true' />
                <span>{t(`peer_review.instructor.why.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
