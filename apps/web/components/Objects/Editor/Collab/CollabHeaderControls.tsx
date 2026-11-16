'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import EditorHeaderControls from '../Header/EditorHeaderControls'
import type { SaveState } from '../Header/SaveIndicator'
import type { CollabSession } from './collabRuntime'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { avatarUrl } from './collabAvatar'
import { useCollabSnapshot } from './CollabContext'
import { type CollabPeer, type CollabSnapshot, deriveStatus, initials } from './collabStatus'
import './collab.css'

const MAX_AVATARS = 3

/**
 * One collaborator: their photo (or initials on their colour), ringed in the
 * colour of their caret and mouse pointer. Click to go to their caret.
 */
function PeerAvatar({ peer, onClick, label, z }: { peer: CollabPeer; onClick: () => void; label: string; z: number }) {
  const url = avatarUrl(peer)
  const [broken, setBroken] = React.useState(false)
  return (
    <ToolTip content={peer.name} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        data-collab-peer={peer.id}
        className={`relative -ms-1 first:ms-0 size-[26px] shrink-0 rounded-full transition-[transform,opacity] hover:!z-20 hover:-translate-y-px focus-visible:!z-20 focus-visible:outline-none ${peer.idle ? 'opacity-55' : ''}`}
        // White gap, then the person's colour (matches their caret and pointer)
        style={{ zIndex: z, boxShadow: `0 0 0 2px var(--lh-collab-avatar-gap, #fff), 0 0 0 3.5px ${peer.color}` }}
      >
        {url && !broken ? (
          <img src={url} alt="" onError={() => setBroken(true)} className="size-full rounded-full object-cover" />
        ) : (
          <span
            className="flex size-full items-center justify-center rounded-full text-[10px] font-bold leading-none tracking-tight text-white"
            style={{ backgroundColor: peer.color }}
          >
            {initials(peer.name)}
          </span>
        )}
      </button>
    </ToolTip>
  )
}

function PresenceAvatars({ session, peers }: { session: CollabSession; peers: CollabPeer[] }) {
  const { t } = useTranslation()
  if (peers.length === 0) return null
  // Room for MAX_AVATARS: show them all, else MAX_AVATARS - 1 and a "+N"
  const shown = peers.length <= MAX_AVATARS ? peers : peers.slice(0, MAX_AVATARS - 1)
  const hidden = peers.slice(shown.length)
  const jump = (peer: CollabPeer) => {
    if (!session.scrollToUser(peer.id)) {
      toast(t('editor.collab.no_cursor', '{{name}} has no cursor in the page right now', { name: peer.name }))
    }
  }
  return (
    <div className="flex items-center px-1.5" data-testid="collab-presence">
      {/* The first is on top of the stack */}
      {shown.map((peer, i) => (
        <PeerAvatar
          key={peer.id}
          peer={peer}
          z={shown.length - i}
          onClick={() => jump(peer)}
          label={t('editor.collab.jump_to', 'Go to {{name}}', { name: peer.name })}
        />
      ))}
      {hidden.length > 0 && (
        <ToolTip
          side="bottom"
          content={
            <span className="flex flex-col gap-0.5">
              {hidden.map((p) => (
                <span key={p.id} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
                </span>
              ))}
            </span>
          }
        >
          <span
            tabIndex={0}
            aria-label={hidden.map((p) => p.name).join(', ')}
            data-testid="collab-presence-more"
            className="relative -ms-1 flex size-[26px] items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold tabular-nums text-neutral-600 outline-none"
            style={{ boxShadow: '0 0 0 2px var(--lh-collab-avatar-gap, #fff)' }}
          >
            +{hidden.length}
          </span>
        </ToolTip>
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
  return { status: map[status], lastSavedAt: snapshot.lastSavedAt, collaborative: true }
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
