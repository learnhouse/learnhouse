'use client'
/*
 Settings popover body for the Code playground (author only). Every field
 commits once (blur / Enter / click), never per keystroke.
*/
import React from 'react'
import { ArrowCounterClockwise, CircleNotch, Database, Trash, UploadSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, Segmented, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { LIMITS, clampTimeLimitMs } from './runner'

export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTY_STYLE: Record<Difficulty, { chip: string; darkChip: string; dot: string; labelKey: string }> = {
  easy: { chip: 'bg-emerald-50 text-emerald-700', darkChip: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400', labelKey: 'editor.blocks.code_playground.difficulty_easy' },
  medium: { chip: 'bg-amber-50 text-amber-700', darkChip: 'bg-amber-500/15 text-amber-400', dot: 'bg-amber-400', labelKey: 'editor.blocks.code_playground.difficulty_medium' },
  hard: { chip: 'bg-rose-50 text-rose-700', darkChip: 'bg-red-500/15 text-red-400', dot: 'bg-red-400', labelKey: 'editor.blocks.code_playground.difficulty_hard' },
}

export const COMPLEXITY_OPTIONS = [
  { value: '', labelKey: 'editor.blocks.code_playground.complexity_not_set' },
  { value: 'O(1)', labelKey: 'editor.blocks.code_playground.complexity_minimal' },
  { value: 'O(log n)', labelKey: 'editor.blocks.code_playground.complexity_very_efficient' },
  { value: 'O(n)', labelKey: 'editor.blocks.code_playground.complexity_efficient' },
  { value: 'O(n log n)', labelKey: 'editor.blocks.code_playground.complexity_moderate' },
  { value: 'O(n²)', labelKey: 'editor.blocks.code_playground.complexity_intensive' },
  { value: 'O(2ⁿ)', labelKey: 'editor.blocks.code_playground.complexity_very_intensive' },
]

interface Props {
  attrs: Record<string, any>
  commit: (_patch: Record<string, any>) => void
  isSql: boolean
  uploadingDb: boolean
  onPickDb: () => void
  onResetStarter: () => void
  canResetStarter: boolean
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (_v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-neutral-900' : 'bg-neutral-200')}
    >
      <span className={cn('absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-[inset-inline-start]', checked ? 'start-[18px]' : 'start-0.5')} />
    </button>
  )
}

/** A number input that commits a clamped value on blur / Enter. */
function NumberField({ value, min, max, onCommit, suffix, label }: { value: number; min: number; max: number; onCommit: (_n: number) => void; suffix?: string; label: string }) {
  return (
    <div className="relative">
      <CommitInput
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={String(value)}
        aria-label={label}
        className={cn(FIELD_CLASS, suffix && 'pe-12')}
        onCommit={(v) => {
          const n = Math.round(Number(v))
          if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)))
        }}
      />
      {suffix && <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400">{suffix}</span>}
    </div>
  )
}

export default function SettingsPanel({ attrs, commit, isSql, uploadingDb, onPickDb, onResetStarter, canResetStarter }: Props) {
  const { t } = useTranslation()
  const difficulty: Difficulty = attrs.difficulty === 'easy' || attrs.difficulty === 'hard' ? attrs.difficulty : 'medium'
  const timeLimitS = Math.round(clampTimeLimitMs(attrs.timeLimitMs ?? 10000) / 1000)
  const attempts = typeof attrs.maxAttemptsBeforeReveal === 'number' ? attrs.maxAttemptsBeforeReveal : 3
  const timedMinutes = Math.max(1, Math.round((attrs.timedDurationMs ?? 300000) / 60000))
  const selectClass = cn(FIELD_CLASS, 'cursor-pointer appearance-none')

  return (
    <div className="flex max-h-[min(70vh,560px)] flex-col gap-3.5 overflow-y-auto pe-0.5">
      <SettingsField label={t('editor.blocks.code_playground.difficulty', 'Difficulty')}>
        <Segmented
          ariaLabel={t('editor.blocks.code_playground.difficulty', 'Difficulty')}
          value={difficulty}
          onChange={(d) => d !== difficulty && commit({ difficulty: d })}
          options={(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => ({
            value: d,
            label: <><span className={cn('h-1.5 w-1.5 rounded-full', DIFFICULTY_STYLE[d].dot)} />{t(DIFFICULTY_STYLE[d].labelKey)}</>,
          }))}
        />
      </SettingsField>

      <div className="grid grid-cols-2 gap-2.5">
        <SettingsField label={t('editor.blocks_v2.code.time_limit', 'Time limit')}>
          <NumberField
            label={t('editor.blocks_v2.code.time_limit', 'Time limit')}
            value={timeLimitS}
            min={LIMITS.timeLimitMinS}
            max={LIMITS.timeLimitMaxS}
            suffix="s"
            onCommit={(s) => commit({ timeLimitMs: s * 1000 })}
          />
        </SettingsField>
        <SettingsField label={t('editor.blocks.code_playground.attempts_to_unlock', 'Attempts to unlock')}>
          <NumberField label={t('editor.blocks.code_playground.attempts_to_unlock', 'Attempts to unlock')} value={attempts} min={0} max={20} onCommit={(n) => commit({ maxAttemptsBeforeReveal: n })} />
        </SettingsField>
      </div>
      <p className="-mt-2 text-[11px] leading-snug text-neutral-400">
        {t('editor.blocks_v2.code.limits_hint', 'Learners see a timer against the time limit while their code runs. The solution unlocks after that many test runs (0: right away).')}
      </p>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-neutral-600">{t('editor.blocks.code_playground.timed_challenge', 'Timed challenge')}</div>
          <div className="text-[11px] leading-snug text-neutral-400">{t('editor.blocks.code_playground.timed_challenge_hint')}</div>
        </div>
        <Toggle checked={!!attrs.timedMode} label={t('editor.blocks.code_playground.timed_challenge', 'Timed challenge')} onChange={(v) => commit({ timedMode: v })} />
      </div>
      {attrs.timedMode && (
        <SettingsField label={t('editor.blocks.code_playground.duration_minutes', 'Duration (minutes)')}>
          <NumberField label={t('editor.blocks.code_playground.duration_minutes', 'Duration (minutes)')} value={timedMinutes} min={1} max={120} suffix="min" onCommit={(m) => commit({ timedDurationMs: m * 60000 })} />
        </SettingsField>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <SettingsField label={t('editor.blocks.code_playground.expected_speed', 'Expected speed')}>
          <select value={attrs.timeComplexity || ''} onChange={(e) => commit({ timeComplexity: e.target.value })} className={selectClass}>
            {COMPLEXITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </select>
        </SettingsField>
        <SettingsField label={t('editor.blocks.code_playground.expected_memory', 'Expected memory')}>
          <select value={attrs.spaceComplexity || ''} onChange={(e) => commit({ spaceComplexity: e.target.value })} className={selectClass}>
            {COMPLEXITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </select>
        </SettingsField>
      </div>

      {isSql && (
        <SettingsField label={t('editor.blocks.code_playground.sqlite_database', 'SQLite database')} hint={t('editor.blocks.code_playground.sqlite_hint')}>
          {attrs.sqliteDbPath ? (
            <div className="flex h-8 items-center gap-2 rounded-lg bg-neutral-50 px-2.5 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.08))]">
              <Database size={14} className="shrink-0 text-neutral-500" />
              <span className="flex-1 truncate text-xs text-neutral-700">{attrs.sqliteDbName || 'database.sqlite'}</span>
              <button type="button" aria-label={t('common.delete', 'Delete')} className="text-neutral-400 hover:text-rose-600" onClick={() => commit({ sqliteDbPath: '', sqliteDbName: '' })}>
                <Trash size={13} />
              </button>
            </div>
          ) : (
            <button type="button" className={cn(buttonClass('secondary', 'sm'), 'w-full')} onClick={onPickDb} disabled={uploadingDb}>
              {uploadingDb ? <CircleNotch size={13} className="animate-spin" /> : <UploadSimple size={13} />}
              {uploadingDb ? t('editor.blocks.code_playground.uploading') : t('editor.blocks.code_playground.upload_sqlite')}
            </button>
          )}
        </SettingsField>
      )}

      <div className="border-t border-neutral-100 pt-3">
        <button type="button" className={cn(buttonClass('ghost', 'sm'), '-ms-2')} onClick={onResetStarter} disabled={!canResetStarter}>
          <ArrowCounterClockwise size={13} /> {t('editor.blocks_v2.code.reset_starter', 'Reset starter code to the language template')}
        </button>
      </div>
    </div>
  )
}
