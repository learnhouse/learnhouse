'use client'
import React, { useState } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, RocketLaunch, UserPlus, ArrowUpRight } from '@phosphor-icons/react'
import { Button, INPUT, buttonClass } from '@/design'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getUriWithOrg } from '@services/config/config'

function absolute(url: string) {
  if (typeof window === 'undefined' || /^https?:\/\//.test(url)) return url
  return `${window.location.origin}${url}`
}

/**
 * Shown once, the first time a course goes live: a moment to celebrate, the
 * school's link to share and the way to invite the first learners.
 */
export default function FirstPublishCelebration({
  open,
  onClose,
  orgSlug,
  orgName,
  onInvite,
}: {
  open: boolean
  onClose: () => void
  orgSlug: string
  orgName: string
  onInvite: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const link = absolute(getUriWithOrg(orgSlug, '/'))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      /* selectable field */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const body = (
    <div className="flex flex-col items-center gap-5 px-2 pb-2 pt-4 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"
      >
        <RocketLaunch size={26} weight="duotone" />
      </motion.div>
      <div>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900">{t('onb2.celebrate.title')}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t('onb2.celebrate.subtitle', { name: orgName })}</p>
      </div>
      <div className="flex w-full items-center gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${INPUT} min-w-0 flex-1`} aria-label={t('onb2.celebrate.link')} />
        <Button variant="secondary" icon={copied ? <Check size={14} weight="bold" /> : <Copy size={14} />} onClick={copy}>
          {copied ? t('onb2.invite.copied') : t('onb2.invite.copy')}
        </Button>
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Button variant="primary" className="flex-1 justify-center" icon={<UserPlus size={14} />} onClick={onInvite}>
          {t('onb2.celebrate.invite')}
        </Button>
        <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md', 'flex-1 justify-center')}>
          {t('onb2.celebrate.view')}
          <ArrowUpRight size={13} weight="bold" data-dir-flip />
        </a>
      </div>
    </div>
  )

  return <Modal isDialogOpen={open} onOpenChange={(o) => !o && onClose()} size="sm" dialogContent={body} />
}
