'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { BracketsCurly, Eye, ListBullets, LinkSimple, TextB, TextItalic, Trash, EnvelopeSimple } from '@phosphor-icons/react'
import { Button, ConfirmDialog, FieldLabel, INPUT, TEXTAREA } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import {
  EMAIL_CATEGORIES,
  EMAIL_VARIABLES,
  createTemplate,
  deleteTemplate,
  opsKeys,
  updateTemplate,
  type EmailTemplate,
} from '@services/ee/platform/ops'
import { useAccessToken } from '@components/Admin/hooks'
import { IconTile, SideDrawer } from '@components/Admin/Shared/OpsKit'
import { MarkdownPreview, fillVariables, findVariables } from './markdown'

// Create / edit an email template: subject + markdown body with a variables
// helper and a live preview filled with sample values. Opened from
// `?template=<uuid>` or `?template=new`.

type FieldKey = 'subject' | 'body'

export default function TemplateEditor({
  templateId,
  template,
  canEdit,
  onClose,
}: {
  templateId: string | null
  template?: EmailTemplate | null
  canEdit: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const isNew = templateId === 'new'
  const [name, setName] = React.useState('')
  const [category, setCategory] = React.useState<string>('product')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [showPreview, setShowPreview] = React.useState(false)
  const subjectRef = React.useRef<HTMLInputElement>(null)
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)
  const lastField = React.useRef<FieldKey>('body')

  // Load the template into the form each time a different one opens.
  React.useEffect(() => {
    if (!templateId) return
    setName(template?.name ?? '')
    setCategory(template?.category ?? 'product')
    setSubject(template?.subject ?? '')
    setBody(template?.body ?? '')
    setShowPreview(false)
  }, [templateId, template])

  const unknown = findVariables(`${subject}\n${body}`).filter((v) => !(EMAIL_VARIABLES as readonly string[]).includes(v))
  const valid = !!name.trim() && !!subject.trim() && !!body.trim() && unknown.length === 0

  // Insert at the cursor of the field the member last used (subject or body).
  const insert = (before: string, after = '', placeholder = '') => {
    const field = lastField.current
    const el = field === 'subject' ? subjectRef.current : bodyRef.current
    const value = field === 'subject' ? subject : body
    const set = field === 'subject' ? setSubject : setBody
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    set(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = start + before.length + selected.length + after.length
      el.setSelectionRange(pos, pos)
    })
  }
  const wrapBody = (before: string, after: string, placeholder: string) => {
    lastField.current = 'body'
    insert(before, after, placeholder)
  }

  const save = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const payload = { name: name.trim(), category, subject: subject.trim(), body }
      if (isNew) await createTemplate(token, payload)
      else if (templateId) await updateTemplate(token, templateId, payload)
      toast.success(t('admin.emails.template_saved'))
      qc.invalidateQueries({ queryKey: opsKeys.templates() })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!templateId || isNew) return
    try {
      await deleteTemplate(token, templateId)
      toast.success(t('admin.emails.template_deleted'))
      qc.invalidateQueries({ queryKey: opsKeys.templates() })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const toolBtn = 'h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-40'

  const preview = (
    <div className="space-y-3 min-w-0">
      <p className="text-xs font-semibold text-neutral-400">{t('admin.emails.live_preview')}</p>
      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 bg-white">
        <div className="px-4 py-3 border-b border-neutral-100">
          <p className="text-[11px] text-neutral-400">{t('admin.emails.subject')}</p>
          <p className="text-sm font-semibold text-neutral-900 break-words">{fillVariables(subject) || '–'}</p>
        </div>
        <div className="px-4 py-4">
          {body.trim() ? <MarkdownPreview source={body} /> : <p className="text-sm text-neutral-400">{t('admin.emails.preview_empty')}</p>}
        </div>
      </div>
      <p className="text-xs text-neutral-400">{t('admin.emails.preview_note')}</p>
    </div>
  )

  return (
    <SideDrawer
      open={!!templateId}
      onClose={onClose}
      width="sm:w-[min(1040px,100vw)]"
      icon={<IconTile icon={<EnvelopeSimple size={18} />} tone="sky" />}
      title={isNew ? t('admin.emails.new_template') : template?.name || t('admin.emails.edit_template')}
      subtitle={!isNew && template?.updated_at ? t('admin.emails.edited', { date: new Date(template.updated_at).toLocaleString() }) : undefined}
      copyHref={isNew ? false : undefined}
      footer={
        <>
          {!isNew && canEdit && (
            <Button variant="danger-ghost" icon={<Trash size={14} />} onClick={() => setConfirmDelete(true)} className="me-auto">
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {canEdit && (
            <Button variant="primary" onClick={save} disabled={!valid} loading={busy}>
              {isNew ? t('admin.emails.create_template') : t('admin.emails.save_template')}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          className="space-y-4 min-w-0"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem] gap-3">
            <div>
              <FieldLabel>{t('admin.emails.name')}</FieldLabel>
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={!canEdit} placeholder={t('admin.emails.name_placeholder')} />
            </div>
            <div>
              <FieldLabel>{t('admin.emails.category_label')}</FieldLabel>
              <select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit}>
                {EMAIL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`admin.emails.category.${c}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-neutral-400">{t(`admin.emails.category_desc.${category}`, { defaultValue: '' })}</p>
          <div>
            <FieldLabel>{t('admin.emails.subject')}</FieldLabel>
            <input
              ref={subjectRef}
              className={INPUT}
              value={subject}
              onFocus={() => (lastField.current = 'subject')}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              disabled={!canEdit}
              placeholder={t('admin.emails.subject_placeholder')}
            />
          </div>
          <div>
            <FieldLabel hint={t('admin.emails.markdown_hint')}>{t('admin.emails.body')}</FieldLabel>
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200 bg-white focus-within:ring-2 focus-within:ring-neutral-900/15">
              <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-neutral-100" role="toolbar" aria-label={t('admin.emails.toolbar')}>
                <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => wrapBody('**', '**', t('admin.emails.md_bold'))} aria-label={t('admin.emails.md_bold')} title={t('admin.emails.md_bold')}>
                  <TextB size={14} weight="bold" />
                </button>
                <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => wrapBody('*', '*', t('admin.emails.md_italic'))} aria-label={t('admin.emails.md_italic')} title={t('admin.emails.md_italic')}>
                  <TextItalic size={14} />
                </button>
                <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => wrapBody('[', '](https://)', t('admin.emails.md_link_text'))} aria-label={t('admin.emails.md_link')} title={t('admin.emails.md_link')}>
                  <LinkSimple size={14} />
                </button>
                <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => wrapBody('\n- ', '', t('admin.emails.md_item'))} aria-label={t('admin.emails.md_list')} title={t('admin.emails.md_list')}>
                  <ListBullets size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  aria-pressed={showPreview}
                  className="lg:hidden ms-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                >
                  <Eye size={13} />
                  {t('admin.emails.preview')}
                </button>
              </div>
              <textarea
                ref={bodyRef}
                rows={12}
                value={body}
                onFocus={() => (lastField.current = 'body')}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canEdit}
                placeholder={t('admin.emails.body_placeholder')}
                className={`${TEXTAREA} ring-0 focus:ring-0 rounded-t-none font-mono text-[13px] resize-y`}
              />
            </div>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 mb-1.5">
              <BracketsCurly size={13} />
              {t('admin.emails.variables')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EMAIL_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={!canEdit}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(`{{${v}}}`)}
                  title={t(`admin.emails.var.${v}`)}
                  className="inline-flex items-center h-6 px-2 rounded-md bg-sky-50 text-sky-700 font-mono text-[11px] hover:bg-sky-100 disabled:opacity-40"
                  dir="ltr"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-400">{t('admin.emails.variables_hint')}</p>
            {unknown.length > 0 && (
              <p className="mt-2 text-xs font-medium text-rose-600" role="alert">
                {t('admin.emails.unknown_variables', { names: unknown.map((v) => `{{${v}}}`).join(', ') })}
              </p>
            )}
          </div>
          {showPreview && <div className="lg:hidden">{preview}</div>}
        </form>
        <div className="hidden lg:block min-w-0">{preview}</div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('admin.emails.delete_template_title', { name: template?.name ?? '' })}
        message={t('admin.emails.delete_template_desc')}
        confirmLabel={t('common.delete')}
        onConfirm={remove}
      />
    </SideDrawer>
  )
}
