'use client';
import React from 'react'
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CaretDown, Check, CircleNotch, DownloadSimple, Lightbulb, Paperclip, UploadSimple } from '@phosphor-icons/react'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { updateAssignmentTask, updateReferenceFile } from '@services/courses/assignments';
import { getTaskRefFileDir } from '@services/media/media';
import { constructAcceptValue } from '@/lib/constants';
import { queryKeys } from '@/lib/query/keys';

const SUPPORTED_FILES = constructAcceptValue(['pdf', 'docx', 'mp4', 'jpg', 'png', 'pptx', 'zip'])

type Field = 'title' | 'description' | 'hint'

// Title, instructions, hint and reference file, edited where they are shown
// instead of on a separate "General" tab. Each field saves on its own when it
// loses focus, so there is no form-level Save button to forget.
function useTaskFieldSave() {
    const { t } = useTranslation()
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token
    const assignment = useAssignments() as any
    const taskState = useAssignmentsTask() as any
    const taskDispatch = useAssignmentsTaskDispatch() as any
    const queryClient = useQueryClient()
    const [saving, setSaving] = React.useState<Field | null>(null)
    const [savedField, setSavedField] = React.useState<Field | null>(null)

    const save = async (field: Field, value: string) => {
        const task = taskState.assignmentTask
        if ((task[field] ?? '') === value) return
        setSaving(field)
        // Every task is graded out of 100; the API still expects the value.
        const res = await updateAssignmentTask(
            { title: task.title, description: task.description, hint: task.hint, max_grade_value: 100, [field]: value },
            task.assignment_task_uuid,
            assignment.assignment_object.assignment_uuid,
            access_token
        )
        setSaving(null)
        if (res) {
            taskDispatch({ type: 'reload' })
            // The task list in the sidebar shows titles too.
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(assignment.assignment_object.assignment_uuid) })
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignment.assignment_object.assignment_uuid) })
            setSavedField(field)
            window.setTimeout(() => setSavedField((f) => (f === field ? null : f)), 1500)
        } else {
            toast.error(t('dashboard.assignments.editor.toasts.task_update_error'))
        }
    }

    return { save, saving, savedField }
}

function SaveTick({ state }: { state: 'saving' | 'saved' | null }) {
    if (!state) return null
    return state === 'saving' ? (
        <CircleNotch size={14} className='animate-spin text-neutral-400 shrink-0' />
    ) : (
        <Check size={14} weight='bold' className='text-emerald-600 shrink-0' />
    )
}

// Text that looks like plain heading/body copy until hovered or focused.
function InlineText({
    value,
    onCommit,
    placeholder,
    className,
    ariaLabel,
    multiline = false,
}: {
    value: string
    onCommit: (value: string) => void
    placeholder: string
    className: string
    ariaLabel: string
    multiline?: boolean
}) {
    const [draft, setDraft] = React.useState(value)
    const [seeded, setSeeded] = React.useState(value)
    // Pick up the saved value when another task is opened or a reload lands.
    if (seeded !== value) {
        setSeeded(value)
        setDraft(value)
    }
    const shared = {
        value: draft,
        placeholder,
        'aria-label': ariaLabel,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
        onBlur: () => onCommit(draft.trim()),
        className: `w-full rounded-lg px-2 -mx-2 bg-transparent hover:bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10 placeholder:text-neutral-400 transition-colors ${className}`,
    }
    return multiline ? (
        <textarea {...shared} rows={Math.min(6, Math.max(1, draft.split('\n').length))} className={`${shared.className} resize-none py-1`} />
    ) : (
        <input
            {...shared}
            type='text'
            onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                    setDraft(value)
                    window.setTimeout(() => (e.target as HTMLInputElement).blur())
                }
            }}
        />
    )
}

export function TaskTitleAndDescription() {
    const { t } = useTranslation()
    const task = (useAssignmentsTask() as any).assignmentTask
    const { save, saving, savedField } = useTaskFieldSave()
    const stateOf = (f: Field) => (saving === f ? 'saving' : savedField === f ? 'saved' : null)

    return (
        <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
                <InlineText
                    value={task.title ?? ''}
                    onCommit={(v) => save('title', v)}
                    placeholder={t('dashboard.assignments.editor.untitled_task')}
                    ariaLabel={t('dashboard.assignments.editor.task_editor.general.title')}
                    className='h-8 text-lg font-semibold text-neutral-900'
                />
                <SaveTick state={stateOf('title')} />
            </div>
            <div className='flex items-start gap-2'>
                <InlineText
                    value={task.description ?? ''}
                    onCommit={(v) => save('description', v)}
                    placeholder={t('dashboard.assignments.editor.inline.description_placeholder')}
                    ariaLabel={t('dashboard.assignments.editor.task_editor.general.description')}
                    className='text-sm text-neutral-600'
                    multiline
                />
                <span className='mt-1.5'><SaveTick state={stateOf('description')} /></span>
            </div>
        </div>
    )
}

export function TaskDetailsRow() {
    const { t } = useTranslation()
    const task = (useAssignmentsTask() as any).assignmentTask
    const { save, saving, savedField } = useTaskFieldSave()
    const [hintOpen, setHintOpen] = React.useState(false)
    const [seenTask, setSeenTask] = React.useState(task.assignment_task_uuid)
    if (seenTask !== task.assignment_task_uuid) {
        setSeenTask(task.assignment_task_uuid)
        setHintOpen(false)
    }
    const hasHint = !!task.hint?.trim()

    return (
        <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
                <button
                    type='button'
                    aria-expanded={hintOpen}
                    onClick={() => setHintOpen((v) => !v)}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${
                        hasHint || hintOpen ? 'bg-amber-50 text-amber-800 hover:bg-amber-100' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                >
                    <Lightbulb size={14} />
                    {hasHint ? t('dashboard.assignments.editor.inline.hint_set') : t('dashboard.assignments.editor.inline.add_hint')}
                    <CaretDown size={11} className={`transition-transform ${hintOpen ? 'rotate-180' : ''}`} />
                </button>
                <ReferenceFilePill />
            </div>
            {hintOpen && (
                <div className='flex items-start gap-2 rounded-xl bg-amber-50/60 ring-1 ring-inset ring-amber-100 px-3 py-2'>
                    <Lightbulb size={14} className='mt-1.5 text-amber-600 shrink-0' />
                    <InlineText
                        value={task.hint ?? ''}
                        onCommit={(v) => save('hint', v)}
                        placeholder={t('dashboard.assignments.editor.inline.hint_placeholder')}
                        ariaLabel={t('dashboard.assignments.editor.task_editor.general.hint')}
                        className='text-sm text-neutral-800 hover:bg-white/60'
                        multiline
                    />
                    <span className='mt-1.5'>
                        <SaveTick state={saving === 'hint' ? 'saving' : savedField === 'hint' ? 'saved' : null} />
                    </span>
                </div>
            )}
        </div>
    )
}

function ReferenceFilePill() {
    const { t } = useTranslation()
    const session = useLHSession() as any
    const org = useOrg() as any
    const access_token = session?.data?.tokens?.access_token
    const task = (useAssignmentsTask() as any).assignmentTask
    const taskDispatch = useAssignmentsTaskDispatch() as any
    const assignment = useAssignments() as any
    const [busy, setBusy] = React.useState(false)
    const inputId = React.useId()

    const upload = async (file: File) => {
        setBusy(true)
        const res = await updateReferenceFile(file, task.assignment_task_uuid, assignment.assignment_object.assignment_uuid, access_token)
        taskDispatch({ type: 'reload' })
        setBusy(false)
        if (res?.success === false) {
            toast.error(res.data?.detail || t('dashboard.assignments.editor.toasts.task_update_error'))
        } else {
            toast.success(t('dashboard.assignments.editor.task_editor.general.reference_file_updated'))
        }
    }

    const href = task.reference_file
        ? getTaskRefFileDir(
              org?.org_uuid,
              assignment.course_object.course_uuid,
              assignment.activity_object.activity_uuid,
              assignment.assignment_object.assignment_uuid,
              task.assignment_task_uuid,
              task.reference_file
          )
        : null

    return (
        <>
            <input
                type='file'
                id={inputId}
                accept={SUPPORTED_FILES}
                className='hidden'
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) upload(file)
                }}
            />
            {busy ? (
                <span className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-500'>
                    <CircleNotch size={14} className='animate-spin' />
                    {t('dashboard.assignments.editor.task_editor.general.loading')}
                </span>
            ) : href ? (
                <span className='inline-flex items-center h-8 rounded-lg bg-sky-50 text-sky-800 text-xs font-semibold'>
                    <Link href={href} download target='_blank' className='inline-flex items-center gap-1.5 h-8 ps-3 pe-2 rounded-s-lg hover:bg-sky-100 transition-colors' title={t('dashboard.assignments.editor.task_editor.general.download')}>
                        <Paperclip size={14} />
                        <span className='uppercase'>{task.reference_file.split('.').pop()}</span>
                        <DownloadSimple size={13} />
                    </Link>
                    <label htmlFor={inputId} className='h-8 ps-2 pe-2.5 inline-flex items-center rounded-e-lg cursor-pointer hover:bg-sky-100 transition-colors' title={t('dashboard.assignments.editor.task_editor.general.change_reference_file')}>
                        <UploadSimple size={13} />
                    </label>
                </span>
            ) : (
                <label
                    htmlFor={inputId}
                    title={t('dashboard.assignments.editor.task_editor.general.reference_file_info')}
                    className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-neutral-100 text-neutral-600 text-xs font-semibold hover:bg-neutral-200 cursor-pointer transition-colors'
                >
                    <Paperclip size={14} />
                    {t('dashboard.assignments.editor.inline.attach_reference')}
                </label>
            )}
        </>
    )
}
