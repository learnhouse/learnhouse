'use client'
import React from 'react'
import { useAICreditPrices } from '@components/Hooks/useAICredits'
import { useFormik } from 'formik'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
    ArrowCounterClockwise,
    BookOpenText,
    CalendarBlank,
    Check,
    ClipboardText,
    Coins,
    HandPointing,
    Power,
    Robot,
    Eye,
    GraduationCap,
    Hash,
    Infinity as InfinityIcon,
    Lightning,
    Lock,
    Minus,
    Paperclip,
    PencilSimple,
    Percent,
    Plus,
    ShieldCheck,
    SlidersHorizontal,
    Target,
    TextAa,
    ThumbsUp,
    Trash,
    UploadSimple,
    Warning,
} from '@phosphor-icons/react'
import { Switch } from '@components/ui/switch'
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
    Button,
    ChoiceCard,
    FieldLabel,
    INPUT,
    SectionCard,
    SettingRow,
    StickySaveBar,
    TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
    deleteAssignmentSolutionFile,
    updateAssignment,
    updateAssignmentSolutionFile,
} from '@services/courses/assignments'
import { queryKeys } from '@/lib/query/keys'
import { AIMarkIcon, aiSurface } from '@components/Objects/AI/AIBrand'
import { sortTasksByOrder } from '@/lib/assignments/taskOrder'

// The assignment settings, as a full tab. This used to be the "Edit settings"
// modal; the form, payload rules and save flow are unchanged, it just has the
// room to breathe now and saves from one sticky bar.

type GradingType = 'ALPHABET' | 'NUMERIC' | 'PERCENTAGE' | 'PASS_FAIL' | 'GPA_SCALE'
type SolutionReveal = 'NEVER' | 'ON_SUBMISSION' | 'AFTER_GRADING'
type AIGradingMode = 'OFF' | 'SUGGEST' | 'AUTO'
// Matches the API's base price per AI-graded submission (material.BASE_CREDITS).
const AI_GRADING_BASE_CREDITS = 2

const GRADING_TYPES: { value: GradingType; labelKey: string; descriptionKey: string; Icon: React.ComponentType<{ size?: number }>; illustration: string }[] = [
    { value: 'ALPHABET', labelKey: 'dashboard.assignments.modals.edit.form.grading_types.alphabet', descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.alphabet', Icon: TextAa, illustration: 'A B C' },
    { value: 'NUMERIC', labelKey: 'dashboard.assignments.modals.edit.form.grading_types.numeric', descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.numeric', Icon: Hash, illustration: '0–100' },
    { value: 'PERCENTAGE', labelKey: 'dashboard.assignments.modals.edit.form.grading_types.percentage', descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.percentage', Icon: Percent, illustration: '85%' },
    { value: 'PASS_FAIL', labelKey: 'dashboard.assignments.modals.edit.form.grading_types.pass_fail', descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.pass_fail', Icon: ThumbsUp, illustration: 'P / F' },
    { value: 'GPA_SCALE', labelKey: 'dashboard.assignments.modals.edit.form.grading_types.gpa_scale', descriptionKey: 'dashboard.assignments.modals.edit.form.grading_type_descriptions.gpa_scale', Icon: GraduationCap, illustration: '0.0–4.0' },
]

// The date input speaks YYYY-MM-DD and nothing else. Values it cannot show
// come back as '' rather than being carried invisibly through the form.
const SECTIONS = ['details', 'grading', 'options', 'solution', 'ai'] as const
type Section = (typeof SECTIONS)[number]
// Which sub-tab edits each form field, for the unsaved dots.
const SECTION_FIELDS: Record<Section, string[]> = {
    details: ['title', 'description', 'due_date'],
    grading: ['ungraded', 'grading_type', 'pass_threshold_percentage'],
    options: ['auto_grading', 'anti_copy_paste', 'show_correct_answers', 'allow_retries', 'max_retries'],
    solution: ['solution', 'solution_reveal'],
    ai: ['ai_grading_mode', 'ai_grading_instructions', 'ai_grading_task_instructions'],
}

function toDateInputValue(raw?: string | null): string {
    const match = /^\d{4}-\d{2}-\d{2}/.exec((raw ?? '').trim())
    return match ? match[0] : ''
}

const STEPPER_BTN =
    'h-7 w-7 inline-flex items-center justify-center rounded-md bg-white ring-1 ring-inset ring-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40'
const SMALL_NUMBER =
    'h-7 text-center text-sm font-semibold text-neutral-900 bg-white rounded-md ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 tabular-nums'

export default function AssignmentGeneralSubPage() {
    const { t } = useTranslation()
    const ctx = useAssignments() as any
    const assignment = ctx?.assignment_object
    const tasks: any[] = Array.isArray(ctx?.assignment_tasks) ? ctx.assignment_tasks : []
    const session = useLHSession() as any
    const accessToken = session?.data?.tokens?.access_token
    const queryClient = useQueryClient()
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)

    // Auto-grading is incompatible with file-submission tasks; those need
    // human review. If any such task exists, we force the toggle off and
    // explain why.
    const hasFileSubmissionTask = tasks.some((task: any) => task?.assignment_type === 'FILE_SUBMISSION')

    // The corrigé document is staged locally and only sent on save, so a
    // teacher who discards doesn't leave a half-applied change behind.
    const [solutionFile, setSolutionFile] = React.useState<File | null>(null)
    const [removeSolutionFile, setRemoveSolutionFile] = React.useState(false)
    const [section, setSection] = useSubTab<Section>('details', SECTIONS, { rememberAs: 'assignment-editor:general' })

    const formik = useFormik({
        initialValues: {
            title: assignment?.title || '',
            description: assignment?.description || '',
            // `<input type="date">` shows nothing for a value carrying a time
            // component, so a stored "2026-01-01T09:00:00" would render as an
            // empty field and quietly save the old deadline straight back.
            // Trim it to the day the input can display.
            due_date: toDateInputValue(assignment?.due_date),
            grading_type: (assignment?.grading_type || 'ALPHABET') as GradingType,
            auto_grading: !!assignment?.auto_grading,
            anti_copy_paste: !!assignment?.anti_copy_paste,
            show_correct_answers: !!assignment?.show_correct_answers,
            allow_retries: !!assignment?.allow_retries,
            // 0 means unlimited.
            max_retries: typeof assignment?.max_retries === 'number' ? assignment.max_retries : 0,
            // Empty string = "use the grading-type default".
            pass_threshold_percentage:
                typeof assignment?.pass_threshold_percentage === 'number' ? assignment.pass_threshold_percentage : ('' as number | ''),
            // Formative mode: handed in but never marked.
            ungraded: !!assignment?.ungraded,
            solution: assignment?.solution || '',
            solution_reveal: (assignment?.solution_reveal || 'NEVER') as SolutionReveal,
            ai_grading_mode: (assignment?.ai_grading_mode || 'SUGGEST') as AIGradingMode,
            ai_grading_instructions: assignment?.ai_grading_instructions || '',
            ai_grading_task_instructions: (assignment?.ai_grading_task_instructions || {}) as Record<string, string>,
        },
        enableReinitialize: true,
        validate: (values) => {
            const errors: Record<string, string> = {}
            if (!values.title.trim()) errors.title = t('dashboard.assignments.modals.edit.form.title_required')
            if (!values.description.trim()) errors.description = t('dashboard.assignments.modals.edit.form.description_required')
            return errors
        },
        onSubmit: async (values, { setSubmitting }) => {
            // Never send auto_grading=true when the assignment has a file task,
            // and drop max_retries back to 0 when retries are off so a stale
            // number doesn't resurface if retries are turned back on.
            const payload: any = hasFileSubmissionTask ? { ...values, auto_grading: false } : { ...values }
            if (!payload.allow_retries) payload.max_retries = 0
            // Clearing the date means "no deadline": send null, not ''.
            payload.due_date = values.due_date || null
            // Formative mode owns the grading switches: send the consistent
            // state rather than leaving stale flags that would resurface if
            // grading is turned back on.
            if (payload.ungraded) {
                payload.auto_grading = false
                payload.show_correct_answers = false
                // AFTER_GRADING can never fire on something never graded.
                if (payload.solution_reveal === 'AFTER_GRADING') payload.solution_reveal = 'ON_SUBMISSION'
            }
            // Blank -> null (fall back to the default); otherwise clamp to 0-100.
            payload.pass_threshold_percentage =
                values.pass_threshold_percentage === '' || values.pass_threshold_percentage === null
                    ? null
                    : Math.max(0, Math.min(100, Number(values.pass_threshold_percentage)))

            const toastId = toast.loading(t('dashboard.assignments.modals.edit.toasts.updating'))
            try {
                const res = await updateAssignment(payload, assignment.assignment_uuid, accessToken)
                if (res.success) {
                    // The corrigé document lives behind its own endpoint, so it
                    // is applied after the field update and only when staged.
                    if (removeSolutionFile) {
                        await deleteAssignmentSolutionFile(assignment.assignment_uuid, accessToken)
                    } else if (solutionFile) {
                        const fileRes = await updateAssignmentSolutionFile(solutionFile, assignment.assignment_uuid, accessToken)
                        if (!fileRes.success) {
                            toast.error(t('dashboard.assignments.modals.edit.toasts.solution_file_error', { defaultValue: "The model answer document couldn't be uploaded." }))
                        }
                    }
                    setSolutionFile(null)
                    setRemoveSolutionFile(false)
                    await queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignment.assignment_uuid) })
                    queryClient.invalidateQueries({ queryKey: ['assignments-all'] })
                    toast.success(t('dashboard.assignments.modals.edit.toasts.success'))
                } else {
                    toast.error(t('dashboard.assignments.modals.edit.toasts.error'))
                }
            } catch {
                toast.error(t('dashboard.assignments.modals.edit.toasts.error_detail'))
            } finally {
                toast.dismiss(toastId)
                setSubmitting(false)
            }
        },
    })

    if (!assignment) return null

    const v = formik.values
    const set = (field: string, value: unknown) => formik.setFieldValue(field, value, true)
    const isDirty = formik.dirty || !!solutionFile || removeSolutionFile
    const discard = () => {
        formik.resetForm()
        setSolutionFile(null)
        setRemoveSolutionFile(false)
    }
    const showErrors = formik.submitCount > 0
    const sectionDirty = (key: Section) =>
        // JSON compare: the per-task AI instructions are an object, and formik
        // hands back a copy, so a reference check would always read dirty.
        SECTION_FIELDS[key].some((field) => JSON.stringify((formik.values as any)[field]) !== JSON.stringify((formik.initialValues as any)[field])) ||
        (key === 'solution' && (!!solutionFile || removeSolutionFile))
    // Title and description are the only required fields: open their sub-tab
    // when a save is blocked by them, so the errors are on screen.
    const save = async () => {
        const errors = await formik.validateForm()
        if (errors.title || errors.description) setSection('details')
        await formik.submitForm()
    }

    const currentFileName = removeSolutionFile ? null : assignment.solution_file ?? null
    const revealOptions: { value: SolutionReveal; label: string; hint: string; icon: React.ReactNode }[] = [
        {
            value: 'NEVER',
            label: t('dashboard.assignments.modals.edit.form.solution_reveal_never', { defaultValue: 'Never' }),
            hint: t('dashboard.assignments.modals.edit.form.solution_reveal_never_hint', { defaultValue: 'Kept for you only' }),
            icon: <Lock size={16} />,
        },
        {
            value: 'ON_SUBMISSION',
            label: t('dashboard.assignments.modals.edit.form.solution_reveal_on_submission', { defaultValue: 'On hand-in' }),
            hint: t('dashboard.assignments.modals.edit.form.solution_reveal_on_submission_hint', { defaultValue: 'Unlocks the moment they submit' }),
            icon: <BookOpenText size={16} />,
        },
        // Dropped in formative mode: it would never unlock.
        ...(v.ungraded
            ? []
            : [{
                value: 'AFTER_GRADING' as SolutionReveal,
                label: t('dashboard.assignments.modals.edit.form.solution_reveal_after_grading', { defaultValue: 'After grading' }),
                hint: t('dashboard.assignments.modals.edit.form.solution_reveal_after_grading_hint', { defaultValue: 'Unlocks once marked' }),
                icon: <Check size={16} />,
            }]),
    ]
    const effectiveReveal: SolutionReveal = v.ungraded && v.solution_reveal === 'AFTER_GRADING' ? 'ON_SUBMISSION' : v.solution_reveal

    return (
        <div className='flex flex-col w-full min-w-0 lg:h-full lg:overflow-y-auto'>
            <form
                onSubmit={formik.handleSubmit}
                className='w-full px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 pb-10 flex flex-col gap-4'
            >
                <SubTabs
                    ariaLabel={t('dashboard.assignments.general.details.title')}
                    value={section}
                    onChange={setSection}
                    items={[
                        { key: 'details', label: t('dashboard.assignments.general.details.title'), icon: <PencilSimple size={15} />, dirty: sectionDirty('details') },
                        { key: 'grading', label: t('dashboard.assignments.general.grading.title'), icon: <GraduationCap size={15} />, dirty: sectionDirty('grading') },
                        { key: 'options', label: t('dashboard.assignments.modals.edit.form.grading_options_label'), icon: <SlidersHorizontal size={15} />, dirty: sectionDirty('options') },
                        {
                            key: 'solution',
                            label: t('dashboard.assignments.modals.edit.form.solution_label', { defaultValue: 'Model answer' }),
                            icon: <BookOpenText size={15} />,
                            dirty: sectionDirty('solution'),
                        },
                        // Formative assignments have nothing to grade.
                        ...(v.ungraded
                            ? []
                            : [{
                                key: 'ai' as Section,
                                label: t('dashboard.assignments.general.ai_grading.title'),
                                icon: <AIMarkIcon size={15} />,
                                dirty: sectionDirty('ai'),
                            }]),
                    ]}
                >
                    <SubTabPanel tab='details' className='flex flex-col gap-4'>
                        {/* Details */}
                        <SectionCard
                            icon={<PencilSimple size={18} />}
                            title={t('dashboard.assignments.general.details.title')}
                            description={t('dashboard.assignments.general.details.description')}
                            bodyClassName='p-5 flex flex-col gap-4'
                        >
                            <label className='block'>
                                <FieldLabel error={showErrors ? (formik.errors.title as string) : undefined}>
                                    {t('dashboard.assignments.modals.edit.form.title_label')}
                                </FieldLabel>
                                <input name='title' type='text' value={v.title} onChange={formik.handleChange} className={INPUT} />
                            </label>
                            <label className='block'>
                                <FieldLabel error={showErrors ? (formik.errors.description as string) : undefined}>
                                    {t('dashboard.assignments.modals.edit.form.description_label')}
                                </FieldLabel>
                                <textarea name='description' rows={3} value={v.description} onChange={formik.handleChange} className={TEXTAREA} />
                            </label>
                            {/* Optional: a self-paced course has no date that means
                                anything to a learner who enrolled today. */}
                            <div>
                                <FieldLabel hint={t('dashboard.assignments.modals.edit.form.due_date_hint')}>
                                    {t('dashboard.assignments.modals.edit.form.due_date_label')}
                                </FieldLabel>
                                <div className='flex items-center gap-2'>
                                    <div className='relative w-full sm:w-60'>
                                        <CalendarBlank size={15} className='pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400' />
                                        <input name='due_date' type='date' value={v.due_date} onChange={formik.handleChange} className={`${INPUT} ps-9`} />
                                    </div>
                                    {v.due_date && (
                                        <Button variant='ghost' size='sm' onClick={() => formik.setFieldValue('due_date', '', false)}>
                                            {t('dashboard.assignments.modals.edit.form.due_date_clear')}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </SectionCard>
                    </SubTabPanel>

                    <SubTabPanel tab='grading' className='flex flex-col gap-4'>
                        {/* Grading */}
                        <SectionCard
                            icon={<GraduationCap size={18} />}
                            title={t('dashboard.assignments.general.grading.title')}
                            description={t('dashboard.assignments.general.grading.description')}
                            bodyClassName='p-5 flex flex-col gap-5'
                        >
                            {/* Formative mode first: turning it on removes most of
                                what follows, so the cause reads before the effect. */}
                            <SettingRow
                                icon={<ClipboardText size={18} className={v.ungraded ? 'text-teal-600' : ''} />}
                                title={t('dashboard.assignments.modals.edit.form.ungraded_label', { defaultValue: 'Formative (no grading)' })}
                                description={t('dashboard.assignments.modals.edit.form.ungraded_description', { defaultValue: 'Learners hand their work in and it is never marked. No score, no pass or fail; pair it with a model answer below for self-assessment.' })}
                                control={<Switch checked={v.ungraded} onCheckedChange={(next) => set('ungraded', next)} />}
                            />

                            {!v.ungraded && (
                                <div>
                                    <FieldLabel hint={t('dashboard.assignments.modals.edit.form.grading_type_hint')}>
                                        {t('dashboard.assignments.modals.edit.form.grading_type_label')}
                                    </FieldLabel>
                                    <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2' role='radiogroup'>
                                        {GRADING_TYPES.map(({ value, labelKey, descriptionKey, Icon, illustration }) => {
                                            const selected = v.grading_type === value
                                            return (
                                                <button
                                                    key={value}
                                                    type='button'
                                                    role='radio'
                                                    aria-checked={selected}
                                                    onClick={() => set('grading_type', value)}
                                                    className={`relative flex flex-col items-start gap-1 rounded-xl p-3 text-start transition-all ${
                                                        selected ? 'bg-white ring-2 ring-neutral-900 shadow-sm' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
                                                    }`}
                                                >
                                                    <span className={`flex items-center gap-1.5 ${selected ? 'text-neutral-900' : 'text-neutral-400'}`}>
                                                        <Icon size={16} />
                                                        <span className='font-mono text-xs font-bold tracking-wide'>{illustration}</span>
                                                    </span>
                                                    <span className='text-sm font-semibold text-neutral-900'>{t(labelKey)}</span>
                                                    <span className='text-xs text-neutral-500 leading-snug'>{t(descriptionKey)}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {!v.ungraded && (
                                <SettingRow
                                    icon={<Target size={18} />}
                                    title={t('dashboard.assignments.modals.edit.form.pass_threshold_label', { defaultValue: 'Passing threshold' })}
                                    description={t('dashboard.assignments.modals.edit.form.pass_threshold_description', { defaultValue: 'Minimum score to pass. Leave blank to use the default (50%, or 60% for letter grades).' })}
                                    control={
                                        <div className='flex items-center gap-1.5'>
                                            <input
                                                type='number'
                                                min={0}
                                                max={100}
                                                placeholder={t('dashboard.assignments.modals.edit.form.pass_threshold_placeholder', { defaultValue: 'Auto' })}
                                                value={v.pass_threshold_percentage === null ? '' : v.pass_threshold_percentage}
                                                onChange={(e) => {
                                                    const raw = e.target.value
                                                    if (raw === '') return set('pass_threshold_percentage', '')
                                                    const parsed = parseInt(raw, 10)
                                                    set('pass_threshold_percentage', isNaN(parsed) ? '' : Math.max(0, Math.min(100, parsed)))
                                                }}
                                                className={`${SMALL_NUMBER} w-16`}
                                            />
                                            <span className='text-xs font-semibold text-neutral-400'>%</span>
                                        </div>
                                    }
                                />
                            )}
                        </SectionCard>
                    </SubTabPanel>

                    <SubTabPanel tab='options' className='flex flex-col gap-4'>
                        {/* Learner experience */}
                        <SectionCard
                            icon={<SlidersHorizontal size={18} />}
                            title={t('dashboard.assignments.modals.edit.form.grading_options_label')}
                            description={t('dashboard.assignments.modals.edit.form.grading_options_hint')}
                            bodyClassName='px-5 pb-5 pt-4 divide-y divide-neutral-100'
                        >
                            {!v.ungraded && (
                                <SettingRow
                                    icon={<Lightning size={18} className='text-amber-500' />}
                                    title={
                                        <span className='inline-flex items-center gap-1.5'>
                                            {t('dashboard.assignments.modals.edit.form.auto_grading_label')}
                                            {hasFileSubmissionTask && <Warning size={13} className='text-amber-500' />}
                                        </span>
                                    }
                                    description={
                                        hasFileSubmissionTask
                                            ? t('dashboard.assignments.modals.edit.form.auto_grading_disabled_file')
                                            : t('dashboard.assignments.modals.edit.form.auto_grading_description')
                                    }
                                    control={
                                        <Switch
                                            checked={!hasFileSubmissionTask && v.auto_grading}
                                            disabled={hasFileSubmissionTask}
                                            onCheckedChange={(next) => set('auto_grading', next)}
                                        />
                                    }
                                />
                            )}
                            <SettingRow
                                icon={<ShieldCheck size={18} className='text-sky-500' />}
                                title={t('dashboard.assignments.modals.edit.form.anti_copy_paste_label')}
                                description={t('dashboard.assignments.modals.edit.form.anti_copy_paste_description')}
                                control={<Switch checked={v.anti_copy_paste} onCheckedChange={(next) => set('anti_copy_paste', next)} />}
                            />
                            {!v.ungraded && (
                                <SettingRow
                                    icon={<Eye size={18} className='text-indigo-500' />}
                                    title={t('dashboard.assignments.modals.edit.form.show_correct_answers_label')}
                                    description={t('dashboard.assignments.modals.edit.form.show_correct_answers_description')}
                                    control={<Switch checked={v.show_correct_answers} onCheckedChange={(next) => set('show_correct_answers', next)} />}
                                />
                            )}
                            <div className='py-4 last:pb-0'>
                                <SettingRow
                                    icon={<ArrowCounterClockwise size={18} className='text-fuchsia-500' />}
                                    title={t('dashboard.assignments.modals.edit.form.allow_retries_label')}
                                    description={
                                        // The default copy says retries happen "after
                                        // it's graded", which never happens in
                                        // formative mode.
                                        v.ungraded
                                            ? t('dashboard.assignments.modals.edit.form.allow_retries_description_ungraded', { defaultValue: 'Let learners reset and hand the assignment in again. Each retry wipes their previous work and re-locks the model answer.' })
                                            : t('dashboard.assignments.modals.edit.form.allow_retries_description')
                                    }
                                    control={<Switch checked={v.allow_retries} onCheckedChange={(next) => set('allow_retries', next)} />}
                                />
                                {v.allow_retries && (
                                    <div className='mt-3 ms-[30px] flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3.5 py-3'>
                                        <div className='min-w-0'>
                                            <p className='text-xs font-semibold text-neutral-800'>{t('dashboard.assignments.modals.edit.form.max_retries_label')}</p>
                                            <p className='mt-0.5 flex items-center gap-1 text-xs text-neutral-500'>
                                                {v.max_retries === 0 && <InfinityIcon size={12} className='text-fuchsia-500' />}
                                                {v.max_retries === 0
                                                    ? t('dashboard.assignments.modals.edit.form.max_retries_unlimited')
                                                    : t('dashboard.assignments.modals.edit.form.max_retries_bounded')}
                                            </p>
                                        </div>
                                        <div className='flex items-center gap-1.5 shrink-0'>
                                            <button
                                                type='button'
                                                onClick={() => set('max_retries', Math.max(0, (v.max_retries || 0) - 1))}
                                                disabled={v.max_retries <= 0}
                                                aria-label='-1'
                                                className={STEPPER_BTN}
                                            >
                                                <Minus size={12} weight='bold' />
                                            </button>
                                            <input
                                                type='number'
                                                min={0}
                                                max={20}
                                                value={v.max_retries}
                                                onChange={(e) => {
                                                    const raw = parseInt(e.target.value, 10)
                                                    set('max_retries', isNaN(raw) ? 0 : Math.max(0, Math.min(20, raw)))
                                                }}
                                                className={`${SMALL_NUMBER} w-12`}
                                            />
                                            <button
                                                type='button'
                                                onClick={() => set('max_retries', Math.min(20, (v.max_retries || 0) + 1))}
                                                disabled={v.max_retries >= 20}
                                                aria-label='+1'
                                                className={STEPPER_BTN}
                                            >
                                                <Plus size={12} weight='bold' />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </SectionCard>
                    </SubTabPanel>

                    <SubTabPanel tab='solution' className='flex flex-col gap-4'>
                        {/* Model answer ("corrigé"). The API enforces the reveal rule
                            server-side; this only chooses it. */}
                        <SectionCard
                            icon={<BookOpenText size={18} />}
                            title={t('dashboard.assignments.modals.edit.form.solution_label', { defaultValue: 'Model answer' })}
                            description={t('dashboard.assignments.modals.edit.form.solution_hint', { defaultValue: 'Shown to learners only once unlocked' })}
                            bodyClassName='p-5 flex flex-col gap-4'
                        >
                            <textarea
                                value={v.solution}
                                onChange={(e) => set('solution', e.target.value)}
                                rows={5}
                                placeholder={t('dashboard.assignments.modals.edit.form.solution_placeholder', { defaultValue: 'Write the worked solution learners should compare their work against…' })}
                                className={TEXTAREA}
                            />
                            <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3.5 py-2.5'>
                                <div className='flex items-center gap-2 min-w-0'>
                                    <Paperclip size={15} className='text-neutral-400 shrink-0' />
                                    {solutionFile || currentFileName ? (
                                        <span className='text-sm font-medium text-neutral-800 truncate'>{solutionFile?.name ?? currentFileName}</span>
                                    ) : (
                                        <span className='text-sm text-neutral-400'>
                                            {t('dashboard.assignments.modals.edit.form.solution_no_file', { defaultValue: 'No document attached' })}
                                        </span>
                                    )}
                                </div>
                                <div className='flex items-center gap-1.5 shrink-0'>
                                    {(solutionFile || currentFileName) && (
                                        <Button
                                            variant='danger-ghost'
                                            size='sm'
                                            icon={<Trash size={13} />}
                                            onClick={() => {
                                                setSolutionFile(null)
                                                setRemoveSolutionFile(true)
                                            }}
                                        >
                                            {t('dashboard.assignments.modals.edit.form.solution_remove_file', { defaultValue: 'Remove' })}
                                        </Button>
                                    )}
                                    <Button size='sm' icon={<UploadSimple size={13} />} onClick={() => fileInputRef.current?.click()}>
                                        {t('dashboard.assignments.modals.edit.form.solution_upload_file', { defaultValue: 'Attach' })}
                                    </Button>
                                    <input
                                        ref={fileInputRef}
                                        type='file'
                                        className='hidden'
                                        onChange={(e) => {
                                            const f = e.target.files?.[0]
                                            if (f) {
                                                setSolutionFile(f)
                                                setRemoveSolutionFile(false)
                                            }
                                            // Reset so re-picking the same file still fires onChange.
                                            e.target.value = ''
                                        }}
                                    />
                                </div>
                            </div>
                            <div>
                                <FieldLabel>{t('dashboard.assignments.modals.edit.form.solution_reveal_label', { defaultValue: 'Unlock the model answer' })}</FieldLabel>
                                <div className={`grid gap-2 grid-cols-1 ${revealOptions.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} role='radiogroup'>
                                    {revealOptions.map((opt) => (
                                        <ChoiceCard
                                            key={opt.value}
                                            selected={effectiveReveal === opt.value}
                                            onClick={() => set('solution_reveal', opt.value)}
                                            icon={opt.icon}
                                            title={opt.label}
                                            description={opt.hint}
                                        />
                                    ))}
                                </div>
                            </div>
                        </SectionCard>
                    </SubTabPanel>
                    <SubTabPanel tab='ai' className='flex flex-col gap-4'>
                        <AIGradingSection
                            mode={v.ai_grading_mode}
                            instructions={v.ai_grading_instructions}
                            taskInstructions={v.ai_grading_task_instructions}
                            tasks={tasks}
                            onChange={set}
                        />
                    </SubTabPanel>
                </SubTabs>

                <StickySaveBar
                    visible={isDirty}
                    saving={formik.isSubmitting}
                    onSave={save}
                    onDiscard={discard}
                />
            </form>
        </div>
    )
}

// The AI grading settings: how it is used, and the rubric the model follows.
// The API hides the rubric from learners; it never leaves the grader's side.
function AIGradingSection({
    mode,
    instructions,
    taskInstructions,
    tasks,
    onChange,
}: {
    mode: AIGradingMode
    instructions: string
    taskInstructions: Record<string, string>
    tasks: any[]
    onChange: (_field: string, _value: unknown) => void
}) {
    const { t } = useTranslation()
    // Published price per AI-graded submission (falls back to the API default).
    const gradingBase = useAICreditPrices().estimate('ai_grading') ?? AI_GRADING_BASE_CREDITS
    const ordered = sortTasksByOrder(tasks)
    const modes: { value: AIGradingMode; label: string; hint: string; icon: React.ReactNode }[] = [
        { value: 'OFF', label: t('dashboard.assignments.general.ai_grading.mode_off'), hint: t('dashboard.assignments.general.ai_grading.mode_off_hint'), icon: <Power size={16} /> },
        { value: 'SUGGEST', label: t('dashboard.assignments.general.ai_grading.mode_suggest'), hint: t('dashboard.assignments.general.ai_grading.mode_suggest_hint'), icon: <HandPointing size={16} /> },
        { value: 'AUTO', label: t('dashboard.assignments.general.ai_grading.mode_auto'), hint: t('dashboard.assignments.general.ai_grading.mode_auto_hint'), icon: <Robot size={16} /> },
    ]
    return (
        <SectionCard
            icon={<AIMarkIcon size={18} />}
            title={t('dashboard.assignments.general.ai_grading.title')}
            description={t('dashboard.assignments.general.ai_grading.description')}
            bodyClassName='p-5 flex flex-col gap-5'
        >
            <div>
                <FieldLabel>{t('dashboard.assignments.general.ai_grading.mode_label')}</FieldLabel>
                <div className='grid gap-2 grid-cols-1 sm:grid-cols-3' role='radiogroup'>
                    {modes.map((opt) => (
                        <ChoiceCard
                            key={opt.value}
                            selected={mode === opt.value}
                            onClick={() => onChange('ai_grading_mode', opt.value)}
                            icon={opt.icon}
                            title={opt.label}
                            description={opt.hint}
                        />
                    ))}
                </div>
                {mode === 'AUTO' && (
                    <p className='mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800'>
                        <Warning size={14} className='shrink-0 mt-px' />
                        {t('dashboard.assignments.general.ai_grading.auto_warning')}
                    </p>
                )}
            </div>

            {mode !== 'OFF' && (
                <>
                    <label className='block'>
                        <FieldLabel hint={t('dashboard.assignments.general.ai_grading.instructions_hint')}>
                            {t('dashboard.assignments.general.ai_grading.instructions_label')}
                        </FieldLabel>
                        <textarea
                            rows={6}
                            maxLength={20000}
                            value={instructions}
                            onChange={(e) => onChange('ai_grading_instructions', e.target.value)}
                            placeholder={t('dashboard.assignments.general.ai_grading.instructions_placeholder')}
                            className={TEXTAREA}
                        />
                    </label>

                    <div>
                        <FieldLabel hint={t('dashboard.assignments.general.ai_grading.task_instructions_hint')}>
                            {t('dashboard.assignments.general.ai_grading.task_instructions_label')}
                        </FieldLabel>
                        {ordered.length === 0 ? (
                            <p className='text-sm text-neutral-400'>{t('dashboard.assignments.general.ai_grading.no_tasks')}</p>
                        ) : (
                            <ol className='flex flex-col gap-2'>
                                {ordered.map((task: any, index: number) => (
                                    <li key={task.assignment_task_uuid} className='rounded-xl bg-neutral-50 p-3'>
                                        <label className='block'>
                                            <span className='mb-1.5 flex items-center gap-2 text-xs font-semibold text-neutral-800'>
                                                <span className='w-5 h-5 rounded-md bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center tabular-nums'>{index + 1}</span>
                                                <span className='truncate'>{task.title}</span>
                                            </span>
                                            <textarea
                                                rows={2}
                                                maxLength={5000}
                                                value={taskInstructions?.[task.assignment_task_uuid] ?? ''}
                                                onChange={(e) =>
                                                    onChange('ai_grading_task_instructions', {
                                                        ...(taskInstructions || {}),
                                                        [task.assignment_task_uuid]: e.target.value,
                                                    })
                                                }
                                                placeholder={t('dashboard.assignments.general.ai_grading.task_instructions_placeholder')}
                                                className={`${TEXTAREA} bg-white`}
                                            />
                                        </label>
                                    </li>
                                ))}
                            </ol>
                        )}
                        <p className='mt-2 flex items-center gap-1.5 text-xs text-neutral-400'>
                            <Lock size={12} />
                            {t('dashboard.assignments.general.ai_grading.hidden_note')}
                        </p>
                    </div>

                    <div className={`${aiSurface.tint} flex items-start gap-3 p-3.5`}>
                        <Coins size={18} className='shrink-0 text-violet-600 mt-px' />
                        <div className='min-w-0'>
                            <p className='text-sm font-semibold text-neutral-900'>{t('dashboard.assignments.general.ai_grading.credits_title')}</p>
                            <p className='mt-0.5 text-xs text-neutral-600'>
                                {t('dashboard.assignments.general.ai_grading.credits_description', { base: gradingBase })}
                            </p>
                        </div>
                    </div>
                </>
            )}
        </SectionCard>
    )
}
