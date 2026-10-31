'use client'
import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, LayoutTemplate, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import EditorPreview from '@components/Objects/Editor/EditorPreview'
import { useAuth } from '@components/Contexts/AuthContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { queryKeys } from '@/lib/query/keys'
import { asArray } from '@services/utils/ts/requests'
import {
  EditorTemplate,
  EditorTemplateKind,
  createEditorTemplate,
  deleteEditorTemplate,
  getEditorTemplates,
} from '@services/courses/dynamicContent'
import { mediaNodeTypes } from './templateContent'

export type TemplatesModalMode = 'insert' | 'save'

interface TemplatesModalProps {
  mode: TemplatesModalMode
  editor: any
  activity: any
  onClose: () => void
}

export default function TemplatesModal(props: TemplatesModalProps) {
  const [mode, setMode] = useState<TemplatesModalMode>(props.mode)
  return mode === 'save' ? (
    <SaveTemplate {...props} />
  ) : (
    <InsertTemplate {...props} onSaveNew={() => setMode('save')} />
  )
}

function useTemplates() {
  const org = useOrg() as any
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: queryKeys.editorTemplates.list(org?.id),
    queryFn: () => getEditorTemplates(org.id, accessToken as string),
    select: (res: any) => asArray<EditorTemplate>(res?.data),
    enabled: !!(org?.id && accessToken),
    staleTime: 30_000,
  })
}

function InsertTemplate({ editor, activity, onClose, onSaveNew }: TemplatesModalProps & { onSaveNew: () => void }) {
  const { t } = useTranslation()
  const { accessToken } = useAuth()
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { data: templates = [], isLoading } = useTemplates()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<EditorTemplateKind | 'all'>('all')
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates.filter(
      (tpl) =>
        (kind === 'all' || tpl.kind === kind) &&
        (!q || tpl.name.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q))
    )
  }, [templates, query, kind])
  const selected = visible.find((tpl) => tpl.template_uuid === selectedUuid) ?? visible[0] ?? null

  const insert = (tpl: EditorTemplate, replace: boolean) => {
    const blocks = asArray(tpl.content?.content)
    if (replace) {
      editor.chain().focus().setContent(tpl.content, { emitUpdate: true }).run()
    } else {
      editor.chain().focus().insertContent(blocks).run()
    }
    toast.success(t('editor.templates.inserted', 'Template inserted'))
    onClose()
  }

  const remove = async (tpl: EditorTemplate) => {
    if (!window.confirm(t('editor.templates.delete_confirm', { name: tpl.name, defaultValue: 'Delete the template "{{name}}"?' }))) return
    const res = await deleteEditorTemplate(tpl.template_uuid, accessToken as string)
    if (!res.success) {
      toast.error(res.data?.detail || t('editor.templates.delete_error', 'Could not delete the template'))
      return
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.editorTemplates.list(org?.id) })
  }

  const editorIsEmpty = editor?.isEmpty

  const body = (
    <div className="flex h-[65vh] flex-col md:flex-row text-sm">
      <div className="flex w-full shrink-0 flex-col border-gray-100 md:w-72 md:border-e">
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2">
            <Search size={14} className="text-gray-400" />
            <input
              className="w-full py-1.5 outline-none"
              value={query}
              placeholder={t('editor.templates.search', 'Search templates')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 text-xs">
            {(['all', 'block', 'page'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-md px-2 py-1 ${kind === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {t(`editor.templates.kind_${k}`, k === 'all' ? 'All' : k === 'block' ? 'Blocks' : 'Pages')}
              </button>
            ))}
            <button
              type="button"
              onClick={onSaveNew}
              className="ms-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50"
            >
              <Plus size={12} /> {t('editor.templates.save_new', 'Save new')}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {isLoading && <Loader2 className="mx-auto mt-6 animate-spin text-gray-400" size={18} />}
          {!isLoading && visible.length === 0 && (
            <p className="px-3 py-6 text-center text-gray-400">
              {templates.length === 0
                ? t('editor.templates.empty', 'No templates yet. Select some blocks, then choose "Save new".')
                : t('editor.templates.no_match', 'No template matches.')}
            </p>
          )}
          {visible.map((tpl) => (
            <button
              key={tpl.template_uuid}
              type="button"
              onClick={() => setSelectedUuid(tpl.template_uuid)}
              className={`mb-1 flex w-full items-start gap-2 rounded-lg px-3 py-2 text-start ${
                selected?.template_uuid === tpl.template_uuid ? 'bg-violet-50 text-violet-900' : 'hover:bg-gray-50'
              }`}
            >
              {tpl.kind === 'page' ? <FileText size={15} className="mt-0.5 shrink-0" /> : <LayoutTemplate size={15} className="mt-0.5 shrink-0" />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{tpl.name}</span>
                {tpl.description && <span className="block truncate text-xs text-gray-500">{tpl.description}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <EditorPreview content={selected.content} activity={activity} />
            </div>
            <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
              <button
                type="button"
                onClick={() => remove(selected)}
                className="me-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={13} /> {t('editor.templates.delete', 'Delete')}
              </button>
              {selected.kind === 'page' && (
                <button
                  type="button"
                  onClick={() => {
                    if (editorIsEmpty || window.confirm(t('editor.templates.replace_confirm', 'Replace the whole page with this template?'))) {
                      insert(selected, true)
                    }
                  }}
                  className="rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100"
                >
                  {t('editor.templates.replace_page', 'Replace page')}
                </button>
              )}
              <button
                type="button"
                onClick={() => insert(selected, false)}
                className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700"
              >
                {t('editor.templates.insert', 'Insert at cursor')}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-300">
            <LayoutTemplate size={40} />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('editor.templates.title', 'Templates')}
      dialogDescription={t('editor.templates.description', 'Reusable blocks and pages shared by your organization.')}
      minWidth="lg"
      noPadding
      dialogContent={body}
    />
  )
}

function SaveTemplate({ editor, onClose }: TemplatesModalProps) {
  const { t } = useTranslation()
  const { accessToken } = useAuth()
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const hasSelection = !!editor && !editor.state.selection.empty
  const [kind, setKind] = useState<EditorTemplateKind>(hasSelection ? 'block' : 'page')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const content = useMemo(() => {
    if (!editor) return null
    if (kind === 'page') return editor.getJSON()
    const slice = editor.state.selection.content().content.toJSON() ?? []
    return { type: 'doc', content: slice }
  }, [editor, kind])

  const media = useMemo(() => mediaNodeTypes(content), [content])

  const save = async () => {
    if (!name.trim() || !content) return
    setSaving(true)
    const res = await createEditorTemplate(
      { org_id: org.id, name: name.trim(), description: description.trim(), kind, content },
      accessToken as string
    )
    setSaving(false)
    if (!res.success) {
      toast.error(res.data?.detail || t('editor.templates.save_error', 'Could not save the template'))
      return
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.editorTemplates.list(org?.id) })
    toast.success(t('editor.templates.saved', 'Template saved'))
    onClose()
  }

  const body = (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2">
        <KindOption
          active={kind === 'block'}
          disabled={!hasSelection}
          onClick={() => setKind('block')}
          title={t('editor.templates.kind_selection', 'Selected blocks')}
          hint={hasSelection ? t('editor.templates.kind_selection_hint', 'Insert anywhere') : t('editor.templates.select_first', 'Select blocks first')}
        />
        <KindOption
          active={kind === 'page'}
          onClick={() => setKind('page')}
          title={t('editor.templates.kind_whole_page', 'Whole page')}
          hint={t('editor.templates.kind_page_hint', 'Start new activities from it')}
        />
      </div>
      <input
        autoFocus
        className="w-full rounded-lg border border-gray-200 px-3 py-2"
        value={name}
        maxLength={120}
        placeholder={t('editor.templates.name', 'Template name')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <textarea
        className="h-20 w-full rounded-lg border border-gray-200 px-3 py-2"
        value={description}
        maxLength={500}
        placeholder={t('editor.templates.description_placeholder', 'What is it for? (optional)')}
        onChange={(e) => setDescription(e.target.value)}
      />
      {media.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t(
            'editor.templates.media_warning',
            'Uploaded images, videos, audio and files stay attached to this activity. In other activities they may not load; re-upload them there.'
          )}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100">
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={!name.trim() || saving}
          onClick={save}
          className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : t('editor.templates.save', 'Save template')}
        </button>
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('editor.templates.save_title', 'Save as template')}
      dialogDescription={t('editor.templates.save_description', 'Everyone who authors courses in your organization can reuse it.')}
      minWidth="sm"
      dialogContent={body}
    />
  )
}

function KindOption(props: { active: boolean; disabled?: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex-1 rounded-xl border px-3 py-2 text-start disabled:opacity-50 ${
        props.active ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <span className="block font-semibold">{props.title}</span>
      <span className="block text-xs text-gray-500">{props.hint}</span>
    </button>
  )
}
