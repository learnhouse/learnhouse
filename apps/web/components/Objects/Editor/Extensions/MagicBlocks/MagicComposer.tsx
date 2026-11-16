'use client'
/*
 The Magic block's prompt box: a midnight AI panel (the block's identity,
 same as its toolbar button) with the prompt, ideas, credits and the
 generate / stop button. Used for the first generation and, compact, for
 "ask for changes".
*/
import React from 'react'
import { CreditsIcon } from '@components/Objects/AI/CreditCost'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, PaintBrush, PaperPlaneTilt, Stop, Warning, X } from '@phosphor-icons/react'
import { AIAccentLine, AIButton, AIMark, AIThinking, AI_DARK_SURFACE } from '@components/Objects/AI/AIBrand'
import { cn } from '@/lib/utils'
import { MAGIC_CREDIT_COST, type MagicError } from './magicModel'

export interface CreditsInfo {
  loaded: boolean
  unlimited: boolean
  remaining: number | null
  enough: boolean
  /** The published price of one generation (from the prices table). */
  cost?: number
}

export function CreditsNote({ credits, tone = 'dark' }: { credits: CreditsInfo; tone?: 'dark' | 'light' }) {
  const { t } = useTranslation()
  const low = !credits.enough
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium',
        low ? (tone === 'dark' ? 'text-rose-300' : 'text-rose-600') : tone === 'dark' ? 'text-white/45' : 'text-neutral-500',
      )}
      data-testid="magic-credits"
    >
      <CreditsIcon size={12} tone={tone} />
      {t('ai_credits.magic_cost', { count: credits.cost ?? MAGIC_CREDIT_COST, defaultValue: 'About {{count}} credits per generation' })}
      {credits.loaded && (
        <>
          <span aria-hidden>·</span>
          {credits.unlimited
            ? t('editor.blocks_v2.magic.credits_unlimited', 'unlimited')
            : t('editor.blocks_v2.magic.credits_left', { count: credits.remaining ?? 0, defaultValue: '{{count}} left' })}
        </>
      )}
    </span>
  )
}

export function MagicErrorBox({ error, onRetry, onDismiss }: { error: MagicError; onRetry?: () => void; onDismiss: () => void }) {
  const { t } = useTranslation()
  const title =
    error.kind === 'credits'
      ? t('editor.blocks_v2.magic.err_credits', 'Not enough AI credits for this generation.')
      : error.kind === 'rate'
        ? t('editor.blocks_v2.magic.err_rate', 'Too many generations in a short time. Wait a minute and try again.')
        : error.kind === 'limit'
          ? t('editor.blocks_v2.magic.err_limit', 'This block reached its edit limit. Start a new Magic block to keep going.')
          : error.kind === 'disabled'
            ? t('editor.blocks_v2.magic.err_disabled', 'AI is not available for this organization.')
            : error.kind === 'stopped'
              ? t('editor.blocks_v2.magic.err_stopped', 'The generation stopped before it finished. Try again.')
              : t('editor.blocks_v2.magic.err_other', 'Something went wrong while generating.')
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2.5 ring-1 ring-inset ring-rose-400/30" data-testid="magic-error">
      <Warning size={15} weight="fill" className="mt-px flex-none text-rose-300" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-rose-100">{title}</div>
        {error.kind === 'other' && error.message && <div className="mt-0.5 truncate text-[11px] text-rose-200/70">{error.message}</div>}
      </div>
      {onRetry && error.kind !== 'credits' && error.kind !== 'limit' && error.kind !== 'disabled' && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 flex-none items-center gap-1 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-white hover:bg-white/15"
        >
          <ArrowClockwise size={12} />
          {t('editor.blocks_v2.retry', 'Retry')}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('editor.blocks_v2.dismiss', 'Dismiss')}
        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function MagicComposer({
  mode,
  prompt,
  onPrompt,
  onSubmit,
  onCancel,
  streaming,
  credits,
  error,
  onRetry,
  onDismissError,
  styleActive,
  onClearStyle,
  editsLeft,
  onClose,
  autoFocus,
  header,
  bare,
}: {
  mode: 'create' | 'refine'
  prompt: string
  onPrompt: (_v: string) => void
  onSubmit: (_prompt: string) => void
  onCancel: () => void
  streaming: boolean
  credits: CreditsInfo
  error: MagicError | null
  onRetry: () => void
  onDismissError: () => void
  styleActive: boolean
  onClearStyle: () => void
  /** Edits left in this block's AI session (null when unknown). */
  editsLeft?: number | null
  onClose?: () => void
  autoFocus?: boolean
  /** Shown first inside the panel (the draft's Use this / Try again bar). */
  header?: React.ReactNode
  /** Inside the Magic block's own dark panel: no surface of its own. */
  bare?: boolean
}) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const exhausted = editsLeft !== undefined && editsLeft !== null && editsLeft <= 0
  const canSend = !!prompt.trim() && !streaming && credits.enough && !exhausted
  const send = () => {
    if (canSend) onSubmit(prompt.trim())
  }
  const ideas = [
    ['suggestion_physics', 'suggestion_physics_prompt'],
    ['suggestion_chart', 'suggestion_chart_prompt'],
    ['suggestion_quiz', 'suggestion_quiz_prompt'],
    ['suggestion_memory', 'suggestion_memory_prompt'],
    ['suggestion_calculator', 'suggestion_calculator_prompt'],
    ['suggestion_timeline', 'suggestion_timeline_prompt'],
  ] as const

  return (
    <div
      className={cn(!bare && 'relative overflow-hidden ring-1 ring-inset ring-white/10', !bare && (mode === 'create' ? 'rounded-2xl' : 'rounded-b-2xl'))}
      style={bare ? undefined : { background: AI_DARK_SURFACE }}
      data-testid={`magic-composer-${mode}`}
    >
      {mode === 'create' && !bare && <AIAccentLine className="opacity-80" />}
      <div className={cn('flex flex-col gap-3', bare ? '' : mode === 'create' ? 'p-4 sm:p-5' : 'p-3')}>
        {mode === 'create' && !bare && (
          <div className="flex items-center gap-2.5">
            <AIMark size={30} alt="" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-white/90">{t('editor.blocks.magic_block_content.create_interactive')}</div>
              <div className="text-[12px] text-white/50">{t('editor.blocks.magic_block_content.generate_description')}</div>
            </div>
          </div>
        )}

        {header}
        {error && <MagicErrorBox error={error} onRetry={onRetry} onDismiss={onDismissError} />}

        <div className="rounded-xl bg-white/[0.06] ring-1 ring-inset ring-white/10 transition-shadow focus-within:ring-violet-300/40">
          <textarea
            ref={ref}
            value={prompt}
            rows={mode === 'create' ? 3 : 2}
            disabled={streaming}
            onChange={(e) => onPrompt(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
              if (e.key === 'Escape' && onClose && !streaming) onClose()
            }}
            placeholder={
              mode === 'create'
                ? t('editor.blocks_v2.magic.prompt_placeholder', 'Describe an interactive element: a simulation, a chart, a mini game…')
                : t('editor.blocks.magic_block_content.placeholder_edit')
            }
            aria-label={t('editor.blocks_v2.magic.prompt_label', 'What should the AI build?')}
            className="block w-full resize-none bg-transparent px-3.5 py-3 text-[14px] leading-relaxed text-white outline-none placeholder:text-white/35 disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
            {styleActive && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-violet-400/15 ps-2 pe-1 text-[11px] font-medium text-violet-100 ring-1 ring-inset ring-violet-300/25">
                <PaintBrush size={11} weight="duotone" />
                {t('editor.blocks_v2.magic.style_active', 'Matching a copied style')}
                <button
                  type="button"
                  onClick={onClearStyle}
                  aria-label={t('editor.blocks.magic_block_content.clear_style')}
                  title={t('editor.blocks.magic_block_content.clear_style')}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/15"
                >
                  <X size={9} />
                </button>
              </span>
            )}
            <CreditsNote credits={credits} />
            {editsLeft !== undefined && editsLeft !== null && (
              <span className={cn('text-[11px] font-medium', exhausted ? 'text-rose-300' : 'text-white/45')}>
                {t('editor.blocks_v2.magic.edits_left', { count: Math.max(0, editsLeft), defaultValue: '{{count}} edits left' })}
              </span>
            )}
            <div className="ms-auto flex items-center gap-1.5">
              {onClose && !streaming && (
                <button type="button" onClick={onClose} className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium text-white/55 hover:bg-white/10 hover:text-white">
                  {t('common.cancel', 'Cancel')}
                </button>
              )}
              {streaming ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/15"
                  data-testid="magic-stop"
                >
                  <Stop size={11} weight="fill" />
                  {t('editor.blocks_v2.magic.stop', 'Stop')}
                </button>
              ) : (
                <AIButton
                  size="sm"
                  onClick={send}
                  disabled={!canSend}
                  icon={mode === 'refine' ? <PaperPlaneTilt size={12} weight="fill" /> : undefined}
                  data-testid="magic-generate"
                >
                  {mode === 'create' ? t('editor.blocks_v2.magic.generate', 'Generate') : t('editor.blocks_v2.magic.apply_changes', 'Ask AI')}
                </AIButton>
              )}
            </div>
          </div>
        </div>

        {streaming && <AIThinking tone="dark" label={t('editor.blocks.magic_block_content.creating_magic')} />}
        {!credits.enough && !streaming && (
          <p className="text-[12px] text-rose-200/80">{t('editor.blocks_v2.magic.err_credits', 'Not enough AI credits for this generation.')}</p>
        )}
        {exhausted && (
          <p className="text-[12px] text-rose-200/80">{t('editor.blocks.magic_block_content.max_iterations_reached')}</p>
        )}

        {mode === 'create' && !streaming && !prompt.trim() && (
          <div className="flex flex-wrap gap-1.5">
            {ideas.map(([label, full]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onPrompt(t(`editor.blocks.magic_block_content.${full}`))
                  ref.current?.focus()
                }}
                className="h-7 rounded-full bg-white/[0.06] px-3 text-xs font-medium text-white/60 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10 hover:text-white/85"
              >
                {t(`editor.blocks.magic_block_content.${label}`)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
