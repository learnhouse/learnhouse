'use client'
import React, { useState } from 'react'
import { Copy, Check, Warning } from '@phosphor-icons/react'
import { Trans, useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Button, Chip, Modal } from '@/design'
import { getAPIUrl } from '@services/config/config'
import type { CreatedToken } from '@services/ee/platform/types'

export type { CreatedToken }

export default function TokenCreatedDialog({ token, onClose }: { token: CreatedToken | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context): select the token so ⌘C works.
      const el = document.getElementById('lh-created-token')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      toast.error(t('admin.tokens.copy_blocked'))
    }
  }

  const apiBase = getAPIUrl().replace(/\/$/, '')

  return (
    <Modal
      isDialogOpen={!!token}
      // Intentionally no outside-click / Escape close: the secret cannot be
      // retrieved later; closing must be a deliberate action.
      onOpenChange={() => {}}
      preventClose
      closeOnOutsideClick={false}
      size="md"
      icon={<Warning size={18} className="text-amber-600" />}
      dialogTitle={t('admin.tokens.save_now')}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {t('admin.tokens.saved_token')}
          </Button>
        </div>
      }
      dialogContent={
        token ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-600">
              <Trans i18nKey="admin.tokens.save_body" values={{ name: token.name }} components={{ strong: <strong className="text-neutral-900" /> }} />
            </p>
            <div className="flex items-stretch rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 overflow-hidden">
              <code id="lh-created-token" dir="ltr" className="flex-1 min-w-0 px-3 py-2.5 font-mono text-xs text-neutral-900 break-all">
                {token.token}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 border-s border-neutral-200 hover:bg-neutral-100 flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900"
              >
                {copied ? <Check size={14} weight="bold" className="text-emerald-600" /> : <Copy size={14} />}
                {copied ? t('admin.tokens.copied') : t('admin.tokens.copy')}
              </button>
            </div>
            {(token.role || (Array.isArray(token.scopes) && token.scopes.length > 0)) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {token.role && <Chip>{t(`admin.roles.${token.role}`, { defaultValue: token.role })}</Chip>}
                {(token.scopes ?? []).map((s) => (
                  <Chip key={s} className="!font-mono !text-[11px]">
                    {s}
                  </Chip>
                ))}
              </div>
            )}
            <pre dir="ltr" className="rounded-xl bg-[#1d1d21] ring-1 ring-inset ring-[rgb(255_255_255/0.06)] px-3 py-2.5 text-xs text-[rgb(255_255_255/0.85)] font-mono whitespace-pre-wrap break-all">
              {`curl -H "Authorization: Bearer <token>" \\\n  ${apiBase}/ee/superadmin/organizations`}
            </pre>
          </div>
        ) : null
      }
    />
  )
}
