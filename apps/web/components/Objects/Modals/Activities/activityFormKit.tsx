'use client'
import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, UploadSimple } from '@phosphor-icons/react'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'

// Shared pieces for the activity forms (create and edit), so every type looks
// and behaves the same: labelled fields, a file picker, and the submit button
// pinned in the modal footer.

// ---------- footer hosting ----------
//
// A form rendered inside a Modal with a `footer` cannot hold its own submit
// button there. The modal owner calls useModalFormHost(), wraps the form with
// `wrap`, and passes `footer(...)` to the Modal. The form renders
// <ModalFormActions>, which reports its state to the host and draws nothing.
// Rendered without a host (e.g. the assignments page embeds the assignment
// form directly) <ModalFormActions> draws the button inline instead.

type FormState = { submitting: boolean; canSubmit: boolean; label: string }
type HostCtx = { formId: string; report: (state: FormState | null) => void }

const ModalFormContext = createContext<HostCtx | null>(null)

export function useModalFormHost() {
  const formId = useId()
  const [state, setState] = useState<FormState | null>(null)
  const ctx = useMemo<HostCtx>(() => ({ formId, report: setState }), [formId])
  return {
    submitting: !!state?.submitting,
    wrap: (children: React.ReactNode) => <ModalFormContext.Provider value={ctx}>{children}</ModalFormContext.Provider>,
    // Cancel + primary submit, or nothing while no form is mounted.
    footer: (onCancel: () => void, cancelLabel: string) =>
      state ? (
        <>
          <Button onClick={onCancel} disabled={state.submitting}>
            {cancelLabel}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={state.submitting} disabled={!state.canSubmit}>
            {state.label}
          </Button>
        </>
      ) : undefined,
  }
}

// The id a hosted form must carry so the footer button submits it.
export function useModalFormId(): string | undefined {
  return useContext(ModalFormContext)?.formId
}

export function ModalFormActions({ submitting, canSubmit = true, label }: { submitting: boolean; canSubmit?: boolean; label: string }) {
  const host = useContext(ModalFormContext)
  const report = host?.report
  useEffect(() => {
    report?.({ submitting, canSubmit, label })
  }, [report, submitting, canSubmit, label])
  useEffect(() => () => report?.(null), [report])
  if (host) return null
  return (
    <div className="flex justify-end pt-1">
      <Button type="submit" variant="primary" loading={submitting} disabled={!canSubmit}>
        {label}
      </Button>
    </div>
  )
}

// ---------- fields ----------

export function ActivityField({
  label,
  hint,
  error,
  htmlFor,
  aside,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  htmlFor?: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-neutral-800">
          {label}
        </label>
        {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : aside}
      </div>
      {children}
      {hint && <p className="text-xs text-neutral-400 leading-relaxed">{hint}</p>}
    </div>
  )
}

// A file picker that looks like a drop zone and shows the chosen file.
export function FilePicker({
  accept,
  file,
  onChange,
  required,
  title,
  hint,
}: {
  accept: string
  file: File | null
  onChange: (file: File | null) => void
  required?: boolean
  title: string
  hint?: string
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const id = useId()

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const dropped = e.dataTransfer.files?.[0]
        if (dropped) onChange(dropped)
      }}
      className={`relative flex items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 transition-colors ${
        dragging ? 'border-neutral-400 bg-neutral-50' : file ? 'border-neutral-300 bg-white' : 'border-neutral-300 bg-neutral-50/50 hover:bg-neutral-50'
      }`}
    >
      <span
        className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${
          file ? 'bg-emerald-50 text-emerald-600' : 'bg-white text-neutral-500 ring-1 ring-inset ring-neutral-200'
        }`}
      >
        {file ? <Check size={16} weight="bold" /> : <UploadSimple size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-neutral-800 truncate">{file ? file.name : title}</span>
        <span className="block text-xs text-neutral-400 truncate">
          {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : hint}
        </span>
      </span>
      <Button size="sm" onClick={() => inputRef.current?.click()}>
        {file ? t('dashboard.courses.editor.activity_form.change_file') : t('dashboard.courses.editor.activity_form.choose_file')}
      </Button>
      {/* Visually hidden but focusable by the browser for `required` validation. */}
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept={accept}
        required={required && !file}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        tabIndex={-1}
        aria-label={title}
      />
    </div>
  )
}

// "my-lesson_01.mp4" -> "my lesson 01": a starting name for an uploaded file.
export function nameFromFile(file: File | null): string {
  if (!file) return ''
  return file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
