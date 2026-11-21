'use client'
/* The code block's copy button (editor, DynamicCanva and the static renderer). */
import React from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function CopyButton({ text, className, notify = false }: { text: string; className?: string; notify?: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      contentEditable={false}
      aria-label={copied ? t('editor.blocks_v2.copied', 'Copied') : t('editor.blocks_v2.copy_code', 'Copy code')}
      title={copied ? t('editor.blocks_v2.copied', 'Copied') : t('editor.blocks_v2.copy_code', 'Copy code')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          if (notify) toast.success(t('editor.blocks_v2.code_copied', 'Code copied to the clipboard'))
          setTimeout(() => setCopied(false), 1400)
        }).catch(() => {
          if (notify) toast.error(t('editor.blocks_v2.code_copy_failed', 'Could not copy. Select the code and copy it by hand.'))
        })
      }}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
        copied ? 'text-emerald-400' : 'text-neutral-400 hover:bg-white/10 hover:text-white',
        className,
      )}
    >
      {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      <span className="max-sm:hidden">{copied ? t('editor.blocks_v2.copied', 'Copied') : t('editor.blocks_v2.copy', 'Copy')}</span>
    </button>
  )
}
