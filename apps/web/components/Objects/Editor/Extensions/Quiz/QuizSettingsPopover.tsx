'use client'
import React from 'react'
import { GearSix } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { BlockPopover, Segmented } from '../../Blocks/ui/BlockChrome'
import { ATTEMPT_OPTIONS, type QuizSettings } from './quizModel'

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (_v: boolean) => void; label: string; hint?: string }) {
  const id = React.useId()
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13px] font-medium text-neutral-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          'relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ' +
          (checked ? 'bg-neutral-800' : 'bg-neutral-200')
        }
      >
        <span
          className={
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform ' +
            (checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5')
          }
        />
      </button>
    </div>
  )
}

/** Quiz-wide options. Each control writes the setting at once (one small attr write). */
export function QuizSettingsPopover({ settings, onChange }: { settings: QuizSettings; onChange: (_next: QuizSettings) => void }) {
  const { t } = useTranslation()
  const set = (patch: Partial<QuizSettings>) => onChange({ ...settings, ...patch })
  return (
    <BlockPopover
      title={t('editor.blocks_v2.quiz.settings', 'Quiz settings')}
      width={300}
      trigger={
        <button
          type="button"
          aria-label={t('editor.blocks_v2.quiz.settings', 'Quiz settings')}
          title={t('editor.blocks_v2.quiz.settings', 'Quiz settings')}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-200 text-neutral-600 transition-colors outline-none hover:bg-neutral-300 focus-visible:ring-2 focus-visible:ring-sky-500/40 data-[state=open]:bg-neutral-300"
        >
          <GearSix weight="duotone" size={13} />
        </button>
      }
    >
      <Switch
        checked={settings.shuffleAnswers}
        onChange={(v) => set({ shuffleAnswers: v })}
        label={t('editor.blocks_v2.quiz.shuffle_answers', 'Shuffle options')}
        hint={t('editor.blocks_v2.quiz.shuffle_answers_hint', 'Each learner sees the options in a different order.')}
      />
      <Switch
        checked={settings.shuffleQuestions}
        onChange={(v) => set({ shuffleQuestions: v })}
        label={t('editor.blocks_v2.quiz.shuffle_questions', 'Shuffle questions')}
      />
      <Switch
        checked={settings.showCorrectAnswers}
        onChange={(v) => set({ showCorrectAnswers: v })}
        label={t('editor.blocks_v2.quiz.show_correct', 'Show correct answers')}
        hint={t('editor.blocks_v2.quiz.show_correct_hint', 'After submitting, learners see the right options and your explanations.')}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.quiz.attempts', 'Attempts')}</span>
        <Segmented
          ariaLabel={t('editor.blocks_v2.quiz.attempts', 'Attempts')}
          value={String(settings.maxAttempts)}
          onChange={(v) => set({ maxAttempts: Number(v) })}
          options={ATTEMPT_OPTIONS.map((n) => ({
            value: String(n),
            label: n === 0 ? '∞' : String(n),
            title: n === 0 ? t('editor.blocks_v2.quiz.attempts_unlimited', 'Unlimited') : t('editor.blocks_v2.quiz.attempts_n', { count: n, defaultValue: '{{count}} attempts' }),
          }))}
        />
        <span className="text-[11px] leading-snug text-neutral-400">
          {settings.maxAttempts === 0
            ? t('editor.blocks_v2.quiz.attempts_unlimited_hint', 'Learners can retry as often as they like.')
            : t('editor.blocks_v2.quiz.attempts_limited_hint', { count: settings.maxAttempts, defaultValue: 'Learners get {{count}} tries.' })}
        </span>
      </div>
    </BlockPopover>
  )
}

export default QuizSettingsPopover
