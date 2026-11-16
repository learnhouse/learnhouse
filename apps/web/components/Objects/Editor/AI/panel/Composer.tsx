'use client'
/*
 The AI Editor composer: the request, its sources (files the agent reads,
 links it fetches) and, behind "/", every action. What it applies to (the
 selection, else the page) shows above the field. The credit cost shows on
 the send button's tooltip.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, CircleNotch, LinkSimple, Paperclip, Square, TextT, X } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { type AIEditorFile, uploadAIEditorFile } from '@services/ai/aiEditor'
import { cn } from '@/lib/utils'
import type { CreditCosts, QuickAction } from '../engine/actions'
import CommandMenu, { type CommandMenuHandle } from './CommandMenu'
import type { ActionRun, Heading } from './actionUtils'

export interface PendingFile {
  key: string
  name: string
  progress: number
  file?: AIEditorFile
  error?: string
}

/** Ask the composer to open its "/" menu (optionally on one action's choices). */
export interface MenuRequest {
  n: number
  action: QuickAction | null
}

const MAX_FILES = 5

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onRun,
  busy,
  disabled,
  costs,
  headings,
  atlas,
  selectionText,
  onClearSelection,
  files,
  setFiles,
  canAttach,
  orgId,
  token,
  placement,
  menuRequest,
  inputRef,
}: {
  value: string
  onChange: (_v: string) => void
  onSend: () => void
  onStop: () => void
  onRun: (_run: ActionRun) => void
  busy: boolean
  disabled: boolean
  costs: CreditCosts
  headings: Heading[]
  atlas: boolean
  selectionText: string
  onClearSelection: () => void
  files: PendingFile[]
  setFiles: React.Dispatch<React.SetStateAction<PendingFile[]>>
  canAttach: boolean
  orgId: number | null
  token: string | null
  /** Where the composer sits: the top of an empty panel, or under the thread. */
  placement: 'top' | 'bottom'
  menuRequest: MenuRequest | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const { t } = useTranslation()
  const fileInput = React.useRef<HTMLInputElement>(null)
  const menuRef = React.useRef<CommandMenuHandle>(null)
  const [forced, setForced] = React.useState<MenuRequest | null>(null)
  const uploading = files.some((f) => !f.file && !f.error)
  const slash = value.startsWith('/') && !value.includes('\n')
  const menuOpen = !busy && (slash || !!forced)

  React.useEffect(() => {
    if (menuRequest) {
      setForced(menuRequest)
      inputRef.current?.focus()
    }
  }, [menuRequest, inputRef])

  React.useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value, inputRef])

  const closeMenu = () => {
    setForced(null)
    if (slash) onChange('')
  }

  const run = (r: ActionRun) => {
    setForced(null)
    onChange('')
    onRun(r)
  }

  const addFiles = (list: FileList | null) => {
    if (!list || !orgId || !token) return
    const room = MAX_FILES - files.length
    Array.from(list)
      .slice(0, Math.max(0, room))
      .forEach((file) => {
        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        setFiles((all) => [...all, { key, name: file.name, progress: 0 }])
        uploadAIEditorFile({
          orgId,
          token,
          file,
          onProgress: (p) => setFiles((all) => all.map((f) => (f.key === key ? { ...f, progress: p } : f))),
        })
          .then((info) => setFiles((all) => all.map((f) => (f.key === key ? { ...f, file: info, progress: 1 } : f))))
          .catch((e) => {
            toast.error(e?.message || t('editor.ai_editor_v2.errors.upload'))
            setFiles((all) => all.filter((f) => f.key !== key))
          })
      })
  }

  const addLink = () => {
    const url = window.prompt(t('editor.ai_editor_v2.link_prompt'))?.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      toast.error(t('editor.ai_editor_v2.errors.link'))
      return
    }
    onChange(`${value ? `${value.trimEnd()}\n` : ''}${t('editor.ai_editor_v2.source_line', { url })}\n`)
    inputRef.current?.focus()
  }

  const iconBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/80 disabled:opacity-30'

  return (
    <div className={cn('shrink-0 px-3', placement === 'top' ? 'pt-3' : 'border-t border-white/[0.07] py-3')}>
      {selectionText && (
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-white/45">
          <TextT size={13} className="shrink-0 text-violet-300/80" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-white/70">{t('editor.ai_editor_v2.selection')}</span> · “{selectionText.slice(0, 80)}”
          </span>
          <button type="button" onClick={onClearSelection} aria-label={t('editor.ai_editor_v2.clear_selection')} title={t('editor.ai_editor_v2.clear_selection')} className="rounded p-0.5 text-white/35 hover:text-white/80">
            <X size={11} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
          {files.map((f) => (
            <span key={f.key} className="inline-flex max-w-[180px] items-center gap-1 text-[12px] text-white/60">
              {!f.file ? <CircleNotch size={11} className="animate-spin text-violet-300" /> : <Paperclip size={11} className="text-violet-300/80" />}
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))} aria-label={t('editor.ai_editor_v2.remove_file')} className="rounded p-0.5 text-white/35 hover:text-white">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        {menuOpen && (
          <CommandMenu
            key={forced?.n ?? 'slash'}
            ref={menuRef}
            query={slash ? value.slice(1) : ''}
            costs={costs}
            headings={headings}
            atlas={atlas}
            hasSelection={!!selectionText}
            initialSub={forced?.action ?? null}
            placement={placement === 'top' ? 'below' : 'above'}
            onRun={run}
            onClose={closeMenu}
            onEnterSub={() => slash && onChange('/')}
          />
        )}
        <div className="rounded-xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] transition-shadow focus-within:bg-white/[0.07] focus-within:ring-violet-400/40">
          <textarea
            ref={inputRef}
            value={value}
            rows={placement === 'top' ? 2 : 1}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value)
              if (forced && e.target.value) setForced(null)
            }}
            onBlur={() => setForced(null)}
            onKeyDown={(e) => {
              if (menuOpen && menuRef.current?.onKeyDown(e)) {
                e.preventDefault()
                return
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (!busy && !uploading) onSend()
              }
            }}
            placeholder={selectionText ? t('editor.ai_editor_v2.placeholder_selection') : t('editor.ai_editor_v2.placeholder')}
            aria-label={t('editor.ai_editor_v2.placeholder')}
            className="block max-h-40 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-relaxed text-white/90 placeholder:text-white/30 outline-none disabled:opacity-50"
          />
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
            {canAttach && (
              <>
                <button type="button" onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_FILES} title={t('editor.ai_editor_v2.attach')} aria-label={t('editor.ai_editor_v2.attach')} className={iconBtn}>
                  <Paperclip size={15} />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </>
            )}
            <button type="button" onClick={addLink} title={t('editor.ai_editor_v2.add_link')} aria-label={t('editor.ai_editor_v2.add_link')} className={iconBtn}>
              <LinkSimple size={15} />
            </button>
            <span className="flex-1" />
            {busy ? (
              <button type="button" onClick={onStop} aria-label={t('editor.ai_editor_v2.stop')} title={t('editor.ai_editor_v2.stop')} className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20">
                <Square size={11} weight="fill" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={disabled || uploading || (!value.trim() && !files.some((f) => f.file)) || slash}
                aria-label={t('editor.ai_editor_v2.send')}
                title={t('editor.ai_editor_v2.send_cost', { count: costs.turn })}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-30 [background:linear-gradient(180deg,rgb(139,92,246)_0%,rgb(124,58,237)_100%)]"
              >
                <ArrowUp size={14} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
