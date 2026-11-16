'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  createNote,
  deleteNote,
  listActivityNotes,
  listMyNotes,
  updateNote,
  type LearnerNote,
  type NoteAnchor,
  type NoteDoc,
} from '@services/notes/notes'

export const notesKeys = {
  all: ['notes'] as const,
  activity: (activityUuid: string) => ['notes', 'activity', activityUuid] as const,
  mine: (orgId: number) => ['notes', 'mine', orgId] as const,
}

function useToken(): { token?: string; signedIn: boolean } {
  const session = useLHSession() as any
  return {
    token: session?.data?.tokens?.access_token as string | undefined,
    signedIn: session?.status === 'authenticated',
  }
}

/** The signed-in learner's notes on one lesson, newest first. */
export function useActivityNotes(activityUuid: string | undefined, enabled = true) {
  const { token, signedIn } = useToken()
  return useQuery({
    queryKey: notesKeys.activity(activityUuid || ''),
    queryFn: () => listActivityNotes(activityUuid as string, token),
    enabled: !!activityUuid && signedIn && enabled,
    staleTime: 30_000,
    retry: (count, err: any) => count < 2 && ![401, 403, 404].includes(err?.status),
  })
}

export function useMyNotes(orgId: number | undefined) {
  const { token, signedIn } = useToken()
  return useQuery({
    queryKey: notesKeys.mine(orgId || 0),
    queryFn: () => listMyNotes(orgId as number, { limit: 1000 }, token),
    enabled: !!orgId && signedIn,
    staleTime: 15_000,
  })
}

/** Create / update / delete, keeping the lesson's list in the cache current. */
export function useNoteMutations(activityUuid: string) {
  const qc = useQueryClient()
  const { token } = useToken()
  const key = notesKeys.activity(activityUuid)
  const put = (note: LearnerNote) =>
    qc.setQueryData<LearnerNote[]>(key, (prev = []) => {
      const i = prev.findIndex((n) => n.note_uuid === note.note_uuid)
      if (i === -1) return [note, ...prev]
      const next = prev.slice()
      next[i] = note
      return next
    })
  const invalidateMine = () => qc.invalidateQueries({ queryKey: ['notes', 'mine'] })

  const create = useMutation({
    mutationFn: (data: { content: NoteDoc; anchor?: NoteAnchor | null }) => createNote(activityUuid, data, token),
    onSuccess: (note) => {
      put(note)
      invalidateMine()
    },
  })
  const update = useMutation({
    mutationFn: ({ noteUuid, ...data }: { noteUuid: string; content?: NoteDoc; anchor?: NoteAnchor | null; clear_anchor?: boolean }) =>
      updateNote(noteUuid, data, token),
    onSuccess: (note) => {
      put(note)
      invalidateMine()
    },
  })
  const remove = useMutation({
    mutationFn: (noteUuid: string) => deleteNote(noteUuid, token),
    onSuccess: (_res, noteUuid) => {
      qc.setQueryData<LearnerNote[]>(key, (prev = []) => prev.filter((n) => n.note_uuid !== noteUuid))
      invalidateMine()
    },
  })
  return { create, update, remove }
}
