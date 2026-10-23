'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import {
  ShieldAlert,
  Info,
  Video,
  Plus,
  Trash2,
  Link2,
  Loader2,
  ExternalLink,
  DownloadCloud,
  Check,
  RefreshCw,
} from 'lucide-react'
import {
  useSkyroomStatus,
  useSkyroomLiveClasses,
  useSkyroomRemoteRooms,
} from '@/hooks/queries/useSkyroom'
import {
  createLiveClass,
  deleteLiveClass,
  updateLiveClass,
  createJoinLink,
  importRemoteRoom,
  type SkyroomLiveClass,
  type SkyroomRemoteRoom,
} from '@services/integrations/skyroom/skyroom'

const OrgEditSkyroom: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true

  const { data: status, isLoading: statusLoading } = useSkyroomStatus()
  const enabled = status?.enabled === true

  const { data: liveClasses, isLoading: listLoading } = useSkyroomLiveClasses(
    enabled ? org?.id : undefined
  )

  const orgId = org?.id as number | undefined
  const refreshList = React.useCallback(() => {
    if (orgId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.skyroom.list(orgId),
      })
    }
  }, [orgId, queryClient])

  if (statusLoading) {
    return (
      <div className="sm:mx-10 mx-0 flex items-center gap-2 text-gray-400 text-sm p-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('dashboard.organization.skyroom.loading')}
      </div>
    )
  }

  return (
    <div className="sm:mx-10 mx-0 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500">
          <Video className="w-4 h-4" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-gray-800">
            {t('dashboard.organization.skyroom.title')}
          </h1>
          <p className="text-sm text-gray-500">
            {t('dashboard.organization.skyroom.subtitle')}
          </p>
        </div>
      </div>

      {/* Admin-only warning */}
      {!canEdit && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200/80">
          <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            {t('dashboard.organization.skyroom.admin_only')}
          </p>
        </div>
      )}

      {/* Not configured notice */}
      {!enabled && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-200/80">
          <Info className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-600 space-y-1">
            <p>{t('dashboard.organization.skyroom.not_configured')}</p>
            <p className="text-xs text-gray-500">
              {t('dashboard.organization.skyroom.not_configured_hint')}
            </p>
          </div>
        </div>
      )}

      {enabled && (
        <>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-50 border border-green-200/70 text-sm text-green-700">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {t('dashboard.organization.skyroom.connected')}
          </div>

          <CreateLiveClassForm
            disabled={!canEdit}
            onCreate={async (payload) => {
              const loading = toast.loading(
                t('dashboard.organization.skyroom.toasts.creating')
              )
              try {
                await createLiveClass(org.id, payload, access_token)
                toast.success(
                  t('dashboard.organization.skyroom.toasts.create_success'),
                  { id: loading }
                )
                refreshList()
                return true
              } catch (err: any) {
                toast.error(
                  err?.detail ||
                    t('dashboard.organization.skyroom.toasts.create_error'),
                  { id: loading }
                )
                return false
              }
            }}
          />

          <ImportRoomsSection
            orgId={org.id}
            accessToken={access_token}
            canEdit={canEdit}
            onImported={refreshList}
          />

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 px-1">
              {t('dashboard.organization.skyroom.live_classes')}
            </h2>

            {listLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm p-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('dashboard.organization.skyroom.loading')}
              </div>
            ) : !liveClasses || liveClasses.length === 0 ? (
              <div className="text-sm text-gray-500 px-4 py-6 rounded-xl bg-white nice-shadow text-center">
                {t('dashboard.organization.skyroom.empty')}
              </div>
            ) : (
              liveClasses.map((lc) => (
                <LiveClassRow
                  key={lc.liveclass_uuid}
                  liveClass={lc}
                  canEdit={canEdit}
                  orgId={org.id}
                  accessToken={access_token}
                  onChanged={refreshList}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function CreateLiveClassForm({
  disabled,
  onCreate,
}: {
  disabled: boolean
  onCreate: (_payload: {
    room_name: string
    title: string
    max_users?: number | null
  }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [roomName, setRoomName] = React.useState('')
  const [maxUsers, setMaxUsers] = React.useState<string>('')
  const [submitting, setSubmitting] = React.useState(false)

  // Skyroom room names must be latin and URL-safe. Derive a suggestion from the
  // title so the author rarely has to fill the name field by hand.
  const slugify = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 128)

  const effectiveRoomName = roomName.trim() || slugify(title)

  const reset = () => {
    setTitle('')
    setRoomName('')
    setMaxUsers('')
  }

  const submit = async () => {
    if (!title.trim() || !effectiveRoomName) return
    setSubmitting(true)
    const ok = await onCreate({
      title: title.trim(),
      room_name: effectiveRoomName,
      max_users: maxUsers ? Number(maxUsers) : null,
    })
    setSubmitting(false)
    if (ok) {
      reset()
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white nice-shadow text-sm font-medium text-gray-700 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t('dashboard.organization.skyroom.create')}
      </button>
    )
  }

  return (
    <div className="p-4 rounded-xl bg-white nice-shadow space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {t('dashboard.organization.skyroom.create')}
      </h3>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">
          {t('dashboard.organization.skyroom.fields.title')}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('dashboard.organization.skyroom.fields.title_placeholder')}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">
          {t('dashboard.organization.skyroom.fields.room_name')}
        </label>
        <input
          type="text"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          placeholder={effectiveRoomName || 'math-101'}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 font-mono"
        />
        <p className="text-[11px] text-gray-400">
          {t('dashboard.organization.skyroom.fields.room_name_hint')}
        </p>
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">
          {t('dashboard.organization.skyroom.fields.max_users')}
        </label>
        <input
          type="number"
          min={1}
          value={maxUsers}
          onChange={(e) => setMaxUsers(e.target.value)}
          placeholder={t('dashboard.organization.skyroom.fields.max_users_placeholder')}
          className="w-32 px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !title.trim() || !effectiveRoomName}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('dashboard.organization.skyroom.create')}
        </button>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ImportRoomsSection({
  orgId,
  accessToken,
  canEdit,
  onImported,
}: {
  orgId: number
  accessToken?: string
  canEdit: boolean
  onImported: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [importingId, setImportingId] = React.useState<number | null>(null)

  // Only fetch the remote room list once the section is expanded — getRooms is
  // rate-limited on Skyroom's side, so we don't want it firing on every panel
  // load.
  const {
    data: rooms,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useSkyroomRemoteRooms(orgId, open)

  // Surface the backend's actual reason (e.g. "Skyroom integration is not
  // configured", "Could not reach the Skyroom service") instead of a generic
  // message — that's what makes this failure diagnosable.
  const errorDetail =
    (error as any)?.detail && typeof (error as any).detail === 'string'
      ? ((error as any).detail as string)
      : (error as any)?.message

  const handleImport = async (room: SkyroomRemoteRoom) => {
    setImportingId(room.skyroom_room_id)
    const loading = toast.loading(
      t('dashboard.organization.skyroom.import.importing')
    )
    try {
      await importRemoteRoom(orgId, room.skyroom_room_id, {}, accessToken)
      toast.success(
        t('dashboard.organization.skyroom.import.import_success'),
        { id: loading }
      )
      // Refresh both the imported flags on this list and the live-class list.
      queryClient.invalidateQueries({
        queryKey: queryKeys.skyroom.remoteRooms(orgId),
      })
      onImported()
    } catch (err: any) {
      toast.error(
        err?.detail ||
          t('dashboard.organization.skyroom.import.import_error'),
        { id: loading }
      )
    } finally {
      setImportingId(null)
    }
  }

  return (
    <div className="rounded-xl bg-white nice-shadow overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-start hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <DownloadCloud className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-gray-800">
              {t('dashboard.organization.skyroom.import.title')}
            </h3>
            <p className="text-xs text-gray-500 truncate">
              {t('dashboard.organization.skyroom.import.subtitle')}
            </p>
          </div>
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`}
              />
              {t('dashboard.organization.skyroom.import.refresh')}
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('dashboard.organization.skyroom.loading')}
            </div>
          ) : isError ? (
            <div className="text-sm text-red-500 py-3 space-y-1">
              <p>{t('dashboard.organization.skyroom.import.load_error')}</p>
              {errorDetail && (
                <p className="text-xs text-red-400">{errorDetail}</p>
              )}
            </div>
          ) : !rooms || rooms.length === 0 ? (
            <div className="text-sm text-gray-500 py-3">
              {t('dashboard.organization.skyroom.import.empty')}
            </div>
          ) : (
            <div className="space-y-2">
              {rooms.map((room) => (
                <div
                  key={room.skyroom_room_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {room.title || room.name}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono truncate">
                      {room.name} · #{room.skyroom_room_id}
                    </p>
                  </div>
                  {room.already_imported ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 flex-shrink-0">
                      <Check className="w-3.5 h-3.5" />
                      {t('dashboard.organization.skyroom.import.imported')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleImport(room)}
                      disabled={!canEdit || importingId === room.skyroom_room_id}
                      className="flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {importingId === room.skyroom_room_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <DownloadCloud className="w-3.5 h-3.5" />
                      )}
                      {t('dashboard.organization.skyroom.import.import')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function LiveClassRow({
  liveClass,
  canEdit,
  orgId,
  accessToken,
  onChanged,
}: {
  liveClass: SkyroomLiveClass
  canEdit: boolean
  orgId: number
  accessToken?: string
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState(false)

  const toggleActive = async (checked: boolean) => {
    setBusy(true)
    const loading = toast.loading(
      t('dashboard.organization.skyroom.toasts.updating')
    )
    try {
      await updateLiveClass(
        orgId,
        liveClass.liveclass_uuid,
        { is_active: checked },
        accessToken
      )
      toast.success(
        t('dashboard.organization.skyroom.toasts.update_success'),
        { id: loading }
      )
      onChanged()
    } catch (err: any) {
      toast.error(
        err?.detail ||
          t('dashboard.organization.skyroom.toasts.update_error'),
        { id: loading }
      )
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(t('dashboard.organization.skyroom.confirm_delete'))) {
      return
    }
    setBusy(true)
    const loading = toast.loading(
      t('dashboard.organization.skyroom.toasts.deleting')
    )
    try {
      await deleteLiveClass(orgId, liveClass.liveclass_uuid, accessToken)
      toast.success(
        t('dashboard.organization.skyroom.toasts.delete_success'),
        { id: loading }
      )
      onChanged()
    } catch (err: any) {
      toast.error(
        err?.detail ||
          t('dashboard.organization.skyroom.toasts.delete_error'),
        { id: loading }
      )
      setBusy(false)
    }
  }

  // Generate a login-free join link for the current admin and copy it. access=3
  // (operator) because an admin creating a link from this panel is the one
  // hosting the class.
  const copyJoinLink = async () => {
    setBusy(true)
    const loading = toast.loading(
      t('dashboard.organization.skyroom.toasts.generating_link')
    )
    try {
      const { url } = await createJoinLink(
        orgId,
        liveClass.liveclass_uuid,
        {
          nickname: liveClass.title,
          access: 3,
        },
        accessToken
      )
      try {
        await navigator.clipboard.writeText(url)
        toast.success(
          t('dashboard.organization.skyroom.toasts.link_copied'),
          { id: loading }
        )
      } catch {
        // Clipboard can be blocked (insecure context / permissions); still show
        // the link so the admin can copy it manually.
        toast.success(url, { id: loading, duration: 8000 })
      }
    } catch (err: any) {
      toast.error(
        err?.detail ||
          t('dashboard.organization.skyroom.toasts.link_error'),
        { id: loading }
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white nice-shadow">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-800 truncate">
            {liveClass.title}
          </h4>
          {!liveClass.is_active && (
            <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
              {t('dashboard.organization.skyroom.inactive')}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 font-mono truncate">
          {liveClass.room_name}
          {liveClass.max_users
            ? ` · ${t('dashboard.organization.skyroom.max_users_label', { count: liveClass.max_users })}`
            : ''}
        </p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {liveClass.room_url && (
          <a
            href={liveClass.room_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
            title={t('dashboard.organization.skyroom.open_room')}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button
          type="button"
          onClick={copyJoinLink}
          disabled={busy || !canEdit}
          className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t('dashboard.organization.skyroom.join_link')}
        >
          <Link2 className="w-4 h-4" />
        </button>
        <Switch
          checked={liveClass.is_active}
          onCheckedChange={toggleActive}
          disabled={busy || !canEdit}
          className="mx-1"
        />
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy || !canEdit}
          className="p-2 text-gray-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t('common.delete')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export default OrgEditSkyroom
