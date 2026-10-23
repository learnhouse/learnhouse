import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import toast from 'react-hot-toast'
import {
  CircleNotch,
  VideoCamera,
  X,
  ArrowSquareOut,
  Warning,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { useSkyroomLiveClasses } from '@/hooks/queries/useSkyroom'
import {
  createJoinLink,
  type SkyroomLiveClass,
} from '@services/integrations/skyroom/skyroom'

interface EditorState {
  isEditable: boolean
}

function SkyroomBlockComponent(props: NodeViewProps) {
  const { node, updateAttributes } = props
  const org = useOrg() as any
  const editorState = useEditorProvider() as EditorState
  const session = useLHSession() as any

  const isEditable = editorState?.isEditable
  const access_token = session?.data?.tokens?.access_token
  const orgId = org?.id as number | undefined

  const liveclassUuid: string | null = node.attrs.liveclass_uuid ?? null

  // -----------------------------------------------------------------------
  // STUDENT VIEW: a "Join class" button. We resolve the live class from the
  // org list (cached by the query hook) so we can show its title, then mint a
  // login-free join URL on click with access=1 (normal participant).
  // -----------------------------------------------------------------------
  if (!isEditable) {
    if (!liveclassUuid) return null
    return (
      <NodeViewWrapper className="block-skyroom w-full">
        <StudentJoinCard
          orgId={orgId}
          liveclassUuid={liveclassUuid}
          accessToken={access_token}
        />
      </NodeViewWrapper>
    )
  }

  // -----------------------------------------------------------------------
  // AUTHORING VIEW: pick which live class this block points at.
  // -----------------------------------------------------------------------
  return (
    <NodeViewWrapper className="block-skyroom w-full">
      <AuthoringPicker
        orgId={orgId}
        selectedUuid={liveclassUuid}
        onSelect={(uuid) => updateAttributes({ liveclass_uuid: uuid })}
        onClear={() => updateAttributes({ liveclass_uuid: null })}
      />
    </NodeViewWrapper>
  )
}

// ---------------------------------------------------------------------------

function StudentJoinCard({
  orgId,
  liveclassUuid,
  accessToken,
}: {
  orgId?: number
  liveclassUuid: string
  accessToken?: string
}) {
  const { t } = useTranslation()
  const { data: liveClasses, isLoading } = useSkyroomLiveClasses(orgId)
  const [joining, setJoining] = React.useState(false)

  const liveClass = liveClasses?.find(
    (lc) => lc.liveclass_uuid === liveclassUuid
  )

  const handleJoin = async () => {
    if (!orgId) return
    setJoining(true)
    const loading = toast.loading(t('editor.blocks.skyroom.joining'))
    try {
      const { url } = await createJoinLink(
        orgId,
        liveclassUuid,
        {
          nickname: liveClass?.title || t('editor.blocks.skyroom.participant'),
          access: 1,
        },
        accessToken
      )
      toast.dismiss(loading)
      // Open in a new tab so the lesson stays put behind the live class.
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err: any) {
      toast.error(
        err?.detail || t('editor.blocks.skyroom.join_error'),
        { id: loading }
      )
    } finally {
      setJoining(false)
    }
  }

  // The class was deleted or made inactive after the block was authored.
  if (!isLoading && (!liveClass || liveClass.is_active === false)) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-200/80 text-sm text-gray-500">
        <Warning weight="duotone" className="w-4 h-4 flex-shrink-0" />
        {t('editor.blocks.skyroom.unavailable')}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500">
          <VideoCamera weight="duotone" className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest font-bold text-indigo-400">
            {t('editor.blocks.skyroom.live_class')}
          </p>
          <h4 className="text-sm font-semibold text-gray-800 truncate">
            {isLoading
              ? t('editor.blocks.skyroom.loading')
              : liveClass?.title}
          </h4>
        </div>
      </div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={joining || isLoading}
        className="flex items-center gap-2 flex-shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {joining ? (
          <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowSquareOut weight="bold" className="w-4 h-4" />
        )}
        {t('editor.blocks.skyroom.join')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

function AuthoringPicker({
  orgId,
  selectedUuid,
  onSelect,
  onClear,
}: {
  orgId?: number
  selectedUuid: string | null
  onSelect: (_uuid: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const { data: liveClasses, isLoading } = useSkyroomLiveClasses(orgId)

  const selected = liveClasses?.find(
    (lc: SkyroomLiveClass) => lc.liveclass_uuid === selectedUuid
  )

  return (
    <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <VideoCamera weight="duotone" className="text-neutral-400" size={16} />
          <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
            {t('editor.blocks.skyroom.live_class')}
          </span>
        </div>
        {selectedUuid && (
          <button
            type="button"
            onClick={onClear}
            className="text-neutral-400 hover:text-red-500 transition-colors"
            title={t('common.delete')}
          >
            <X weight="duotone" size={16} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-neutral-400 text-sm py-3">
          <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
          {t('editor.blocks.skyroom.loading')}
        </div>
      ) : !liveClasses || liveClasses.length === 0 ? (
        <div className="text-sm text-neutral-500 py-3">
          {t('editor.blocks.skyroom.none_hint')}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-neutral-500">
            {t('editor.blocks.skyroom.pick_label')}
          </label>
          <select
            value={selectedUuid || ''}
            onChange={(e) => e.target.value && onSelect(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="" disabled>
              {t('editor.blocks.skyroom.pick_placeholder')}
            </option>
            {liveClasses.map((lc: SkyroomLiveClass) => (
              <option key={lc.liveclass_uuid} value={lc.liveclass_uuid}>
                {lc.title}
                {lc.is_active ? '' : ` (${t('editor.blocks.skyroom.inactive')})`}
              </option>
            ))}
          </select>
          {selected && (
            <p className="text-[11px] text-neutral-400 pt-1">
              {t('editor.blocks.skyroom.student_preview_hint')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default SkyroomBlockComponent
