'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import EditorHeaderControls from '../Header/EditorHeaderControls'
import type { SaveState } from '../Header/SaveIndicator'
import type { CollabSession } from './collabRuntime'
import { avatarUrl } from './collabAvatar'
import { useCollabSnapshot } from './CollabContext'
import { type CollabPeer, type CollabSnapshot, deriveStatus, initials } from './collabStatus'
import './collab.css'

const MAX_AVATARS = 3

function PeerAvatar({ peer, onClick, label }: { peer: CollabPeer; onClick: () => void; label: string }) {
  const url = avatarUrl(peer)
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-collab-peer={peer.id}
      className={`relative -ms-1 first:ms-0 size-6 shrink-0 rounded-full ring-2 ring-white transition-opacity hover:z-10 focus-visible:outline-none ${peer.idle ? 'opacity-50' : ''}`}
      style={{ boxShadow: `0 0 0 3px ${peer.color}` }}
    >
      {url ? (
        <img src={url} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: peer.color }}>
          {initials(peer.name)}
        </span>
      )}
    </button>
  )
}

function PresenceAvatars({ session, peers }: { session: CollabSession; peers: CollabPeer[] }) {
  const { t } = useTranslation()
  if (peers.length === 0) return null
  const shown = peers.slice(0, MAX_AVATARS)
  const hidden = peers.slice(MAX_AVATARS)
  const jump = (peer: CollabPeer) => {
    if (!session.scrollToUser(peer.id)) {
      toast(t('editor.collab.no_cursor', '{{name}} has no cursor in the page right now', { name: peer.name }))
    }
  }
  return (
    <div className="flex items-center ps-1" data-testid="collab-presence">
      {shown.map((peer) => (
        <PeerAvatar key={peer.id} peer={peer} onClick={() => jump(peer)} label={t('editor.collab.jump_to', 'Go to {{name}}', { name: peer.name })} />
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map((p) => p.name).join(', ')}
          className="-ms-1 flex size-6 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-2 ring-white"
        >
          +{hidden.length}
        </span>
      )}
    </div>
  )
}

/** The room's state as the shared save indicator shows it. */
export function collabSaveState(snapshot: CollabSnapshot): SaveState {
  const status = deriveStatus(snapshot)
  const map = {
    live: 'live',
    saved: 'live',
    saving: snapshot.saveFailed ? 'failed' : 'saving',
    reconnecting: 'offline',
    readonly: 'readonly',
    error: 'failed',
  } as const
  return { status: map[status], lastSavedAt: snapshot.lastSavedAt }
}

/** Header controls in collaborative mode: presence + the shared controls. */
export default function CollabHeaderControls({
  session,
  ...controls
}: { session: CollabSession } & Omit<
  React.ComponentProps<typeof EditorHeaderControls>,
  'presence' | 'save' | 'onNameVersion' | 'canName'
>) {
  const { t } = useTranslation()
  const snapshot = useCollabSnapshot(session)

  React.useEffect(
    () =>
      session.onExternalUpdate(({ by }) => {
        toast(
          by?.name
            ? t('editor.collab.updated_by', 'Updated by {{name}}', { name: by.name })
            : t('editor.collab.updated_elsewhere', 'This page was updated elsewhere'),
          { icon: '↻', id: 'collab-external-update' },
        )
      }),
    [session, t],
  )

  React.useEffect(() => {
    if (snapshot.terminal === 'access_revoked') {
      toast.error(t('editor.collab.access_revoked', 'You no longer have access to edit this page.'), { id: 'collab-terminal' })
    } else if (snapshot.terminal === 'too_large') {
      toast.error(t('editor.collab.too_large', 'This page is too large to keep editing together. Split it into smaller pages.'), {
        id: 'collab-terminal',
      })
    }
  }, [snapshot.terminal, t])

  return (
    <div className="contents" data-testid="collab-toolbar">
      <EditorHeaderControls
        {...controls}
        presence={<PresenceAvatars session={session} peers={snapshot.peers} />}
        save={collabSaveState(snapshot)}
        canName={!snapshot.readOnly && snapshot.connection === 'connected'}
        onNameVersion={async (label) => (await session.saveVersion(label)).ok}
      />
    </div>
  )
}
