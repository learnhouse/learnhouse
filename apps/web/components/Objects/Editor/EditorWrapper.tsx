'use client'
import { default as React, type JSX } from 'react';
import Editor, { type LegacyEditorHandle } from './Editor'
import { updateActivity, getActivityState, getActivity } from '@services/courses/activities'
import { toast } from 'react-hot-toast'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { OrgProvider } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { preloadComponentsForContent } from './editorPreload'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useAuth } from '@components/Contexts/AuthContext'
import { useActivityCollab } from './Collab/useActivityCollab'
import { useCollabSnapshot } from './Collab/CollabContext'
import { type LiveEditingMode, activityLiveEditingMode, orgLiveEditing, resolveLiveEditing } from './Collab/liveEditing'
import { getAPIUrl } from '@services/config/config'
import { getActivityTranslation, updateActivityTranslation } from '@services/courses/translations'
import { useEditorLocale } from './Translation/EditorLocaleContext'
import { withLocaleQuery } from './Translation/translationEditorModel'

/**
 * Transforms ProseMirror JSON content to fix mark type names.
 * TipTap uses 'bold'/'italic' but AI sometimes generates 'strong'/'em'.
 * This recursively traverses the content and normalizes mark types.
 */
function normalizeMarkTypes(content: any): any {
  if (!content || typeof content !== 'object') {
    return content;
  }

  // If it's an array, process each element
  if (Array.isArray(content)) {
    return content.map(normalizeMarkTypes);
  }

  // Clone the object to avoid mutation
  const normalized: any = { ...content };

  // Fix marks array if present
  if (normalized.marks && Array.isArray(normalized.marks)) {
    normalized.marks = normalized.marks.map((mark: any) => {
      if (mark.type === 'strong') {
        return { ...mark, type: 'bold' };
      }
      if (mark.type === 'em') {
        return { ...mark, type: 'italic' };
      }
      return mark;
    });
  }

  // Recursively process content array if present
  if (normalized.content && Array.isArray(normalized.content)) {
    normalized.content = normalizeMarkTypes(normalized.content);
  }

  return normalized;
}

// How long the editor stays read-only while live editing connects
const GRACE_MS = 1500
// Longest wait for the room to reflect an autosave before switching to it
const HANDOVER_WAIT_MS = 3000

export interface ConflictInfo {
  hasConflict: boolean
  remoteVersion: number
  localVersion: number
  lastModifiedBy: string | null
  lastModifiedAt: string | null
}

interface EditorWrapperProps {
  content: string
  activity: any
  course: any
  org: any
  onEditorReady?: () => void
}

function EditorWrapper(props: EditorWrapperProps): JSX.Element {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('editor')
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const { getAccessToken } = useAuth()
  // Editing a translation (`?lang=`): its own room, saves and version
  const locale = useEditorLocale()?.locale ?? null

  // The editor opens at once on the stored content. Live editing joins in
  // the background: if the room syncs within GRACE_MS the editor switches to
  // it before anyone could type; after that the page is editable in autosave
  // mode and switches over as soon as it has nothing left to save.
  // Live editing (collaboration + autosave) unless an admin turned it off for
  // the org or this activity: then the editor saves manually.
  const [liveMode, setLiveMode] = React.useState<LiveEditingMode>(() => activityLiveEditingMode(props.activity.details))
  const [orgDefault, setOrgDefault] = React.useState<boolean>(() => orgLiveEditing(props.org?.config?.config))
  // Turned off by an admin during this session (we don't know at which level)
  const [forcedOff, setForcedOff] = React.useState(false)
  const liveEditing = resolveLiveEditing(liveMode, orgDefault) && !forcedOff
  const collab = useActivityCollab({
    activityUuid: props.activity.activity_uuid,
    locale,
    enabled: props.activity.activity_sub_type === 'SUBTYPE_DYNAMIC_PAGE' && liveEditing,
    getToken: getAccessToken,
  })
  // The server is the judge (the org default may have changed since load)
  const manualSave = !liveEditing || collab.phase === 'disabled'
  const [contentOverride, setContentOverride] = React.useState<any>(null)
  const [graceOver, setGraceOver] = React.useState(false)
  React.useEffect(() => {
    const id = setTimeout(() => setGraceOver(true), GRACE_MS)
    return () => clearTimeout(id)
  }, [])
  const legacyHandle = React.useRef<LegacyEditorHandle | null>(null)
  const onLegacyHandle = React.useCallback((handle: LegacyEditorHandle | null) => {
    legacyHandle.current = handle
  }, [])
  const [live, setLive] = React.useState(false)
  const [handoverSelection, setHandoverSelection] = React.useState<{ from: number; to: number; focused: boolean } | null>(null)
  React.useEffect(() => {
    if (collab.phase !== 'live' || live) return
    const session = collab.session
    const ready = () => {
      const handle = legacyHandle.current
      // Still read-only (nobody could type yet), or nothing to carry over
      if (!graceOver || !handle) return true
      if (!handle.isClean()) return false
      const savedAt = handle.lastSavedAt()
      // Edited in autosave mode: wait until the room shows that save (the
      // API notifies it), or give it a few seconds
      return !savedAt || handle.matches(session.contentJSON()) || Date.now() - savedAt > HANDOVER_WAIT_MS
    }
    const goLive = () => {
      const handle = legacyHandle.current
      if (graceOver && handle) setHandoverSelection(handle.selection())
      setLive(true)
    }
    const id = setInterval(() => {
      if (ready()) goLive()
    }, 250)
    if (ready()) queueMicrotask(goLive)
    return () => clearInterval(id)
  }, [collab, graceOver, live])
  const liveSession = live && collab.phase === 'live' && liveEditing ? collab.session : null

  // Live editing turned off while in the room: the server saved it and closed
  // the room. Continue on the same content, saving manually.
  const liveSnapshot = useCollabSnapshot(liveSession)
  const switchToManual = React.useCallback(async (session: NonNullable<typeof liveSession>, fromAdmin: boolean) => {
    setContentOverride(session.contentJSON())
    try {
      const state = locale
        ? { current_version: (await getActivityTranslation(props.activity.activity_uuid, locale, access_token)).version }
        : await getActivityState(props.activity.activity_uuid, access_token)
      if (state?.current_version) setLocalVersion(state.current_version)
    } catch {
      // the next save's version check catches up
    }
    if (fromAdmin) {
      toast(t('editor.live_editing.turned_off_toast', 'Live editing was turned off by an admin; changes are now saved manually'), { icon: '✋', id: 'live-editing-off' })
    }
    setLive(false)
    if (fromAdmin) setForcedOff(true)
  }, [props.activity.activity_uuid, access_token, t, locale])
  React.useEffect(() => {
    if (liveSession && liveSnapshot.terminal === 'disabled') void switchToManual(liveSession, true)
  }, [liveSession, liveSnapshot.terminal, switchToManual])

  /** "Live editing" in the editor's History menu: default / on / off for this activity. */
  const setActivityLiveMode = React.useCallback(async (mode: LiveEditingMode) => {
    const handle = legacyHandle.current
    if (!liveEditing && resolveLiveEditing(mode, orgDefault) && handle?.hasUnsavedChanges()) {
      toast.error(t('editor.live_editing.save_first', 'Save your changes before turning live editing on.'))
      return true
    }
    const token = await getAccessToken()
    const res = await fetch(`${getAPIUrl()}activities/${props.activity.activity_uuid}/live-editing`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mode }),
    })
    if (!res.ok) return false
    const body = await res.json()
    if (liveSession && body.effective === false) await switchToManual(liveSession, false)
    else if (!liveSession && body.effective === true && handle) {
      // Going live: keep showing what's on screen (saved) until the room syncs
      setContentOverride(handle.getJSON())
    }
    setOrgDefault(body.org_default)
    setLiveMode(body.mode)
    setForcedOff(false)
    return true
  }, [getAccessToken, props.activity.activity_uuid, liveSession, switchToManual, liveEditing, orgDefault, t])

  // Track the current version we loaded with
  const [localVersion, setLocalVersion] = React.useState<number>(
    props.activity.current_version || 1
  )
  const [_localUpdateDate, setLocalUpdateDate] = React.useState<string>(
    props.activity.update_date || ''
  )

  // Normalize content to fix AI-generated mark types (strong -> bold, em -> italic).
  // Most documents have neither, so we pre-scan the raw JSON for those mark
  // type names before doing the recursive object clone, which avoids allocating a
  // new object per node on every editor open.
  const normalizedContent = React.useMemo(() => {
    if (!props.content) return props.content;
    try {
      const isString = typeof props.content === 'string';
      const rawForScan = isString ? props.content : JSON.stringify(props.content);
      const needsNormalization = /"type"\s*:\s*"(?:strong|em)"/.test(rawForScan);
      const parsed = isString ? JSON.parse(props.content) : props.content;
      return needsNormalization ? normalizeMarkTypes(parsed) : parsed;
    } catch (_e) {
      // If parsing fails, return original content
      return props.content;
    }
  }, [props.content]);

  // Kick off non-awaited dynamic imports for the node-view chunks needed by
  // the blocks present in this document, so they're cached before TipTap renders.
  React.useEffect(() => {
    preloadComponentsForContent(normalizedContent)
  }, [normalizedContent]);

  // Check for remote changes (conflict detection)
  const checkForConflicts = React.useCallback(async (): Promise<ConflictInfo | null> => {
    if (!access_token) return null;

    try {
      const remoteState = locale
        ? await getActivityTranslation(props.activity.activity_uuid, locale, access_token).then((tr) => ({
            current_version: tr.version,
            last_modified_by_username: tr.updated_by,
            update_date: tr.updated_at,
          }))
        : await getActivityState(
        props.activity.activity_uuid,
        access_token
      );

      // Check if remote version is newer than our local version
      const hasConflict = remoteState.current_version > localVersion;

      return {
        hasConflict,
        remoteVersion: remoteState.current_version,
        localVersion,
        lastModifiedBy: remoteState.last_modified_by_username,
        lastModifiedAt: remoteState.update_date,
      };
    } catch (error) {
      console.error('Error checking for conflicts:', error);
      return null;
    }
  }, [props.activity.activity_uuid, access_token, localVersion, locale]);

  // Fetch remote content for merging
  const fetchRemoteContent = React.useCallback(async () => {
    if (!access_token) return null;

    try {
      if (locale) return (await getActivityTranslation(props.activity.activity_uuid, locale, access_token)).content
      const remoteActivity = await getActivity(
        props.activity.activity_uuid,
        null,
        access_token
      );
      return remoteActivity.content;
    } catch (error) {
      console.error('Error fetching remote content:', error);
      return null;
    }
  }, [props.activity.activity_uuid, access_token, locale]);

  // `quiet`: autosave, whose status shows in the header instead of toasts
  async function setContent(content: any, forceOverwrite: boolean = false, options: { quiet?: boolean } = {}) {
    // Autosave: one request, the API checks the version atomically (409 =
    // someone else saved first) and keeps one history entry per few minutes
    if (options.quiet && !forceOverwrite) {
      try {
        const res = await fetch(withLocaleQuery(`${getAPIUrl()}activities/${props.activity.activity_uuid}/content/autosave`, locale), {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content, base_version: localVersion }),
        })
        if (res.status === 409) {
          const detail = (await res.json().catch(() => null))?.detail ?? {}
          const conflictInfo: ConflictInfo = {
            hasConflict: true,
            remoteVersion: detail.current_version ?? localVersion + 1,
            localVersion,
            lastModifiedBy: detail.last_modified_by ?? null,
            lastModifiedAt: detail.update_date ?? null,
          }
          return { hasConflict: true, conflictInfo }
        }
        if (!res.ok) return { hasConflict: false, result: null }
        const data = await res.json()
        setLocalVersion(data.current_version)
        setLocalUpdateDate(data.update_date)
        track(AnalyticsEvent.ActivityContentSaved, { new_version: data.current_version, had_conflict: false, autosave: true })
        return { hasConflict: false, result: { success: true, data } }
      } catch {
        return { hasConflict: false, result: null }
      }
    }

    // Check for conflicts before saving (unless force overwrite)
    if (!forceOverwrite) {
      const conflictInfo = await checkForConflicts();
      if (conflictInfo?.hasConflict) {
        // Don't save if there's a conflict - the UI will handle this
        if (!options.quiet) toast.error(
          t('editor.versioning.conflict.detected', {
            author: conflictInfo.lastModifiedBy || t('editor.versioning.conflict.another_teacher')
          })
        );
        return { hasConflict: true, conflictInfo };
      }
    }

    try {
      // A translation saves to its own row (version checked unless overwriting)
      const save = locale
        ? updateActivityTranslation(props.activity.activity_uuid, locale, { content, ...(forceOverwrite ? {} : { base_version: localVersion }) }, access_token)
            .then((tr) => ({ success: true, data: { current_version: tr.version, update_date: tr.updated_at } }))
            .catch((err: any) => ({ success: false, data: { detail: err?.message } }))
        : updateActivity({ content }, props.activity.activity_uuid, access_token)
      const result = await toast.promise(
        save.then((res: any) => {
          if (!res.success) {
            throw res;
          }
          // Update local version after successful save
          if (res.data?.current_version) {
            setLocalVersion(res.data.current_version);
            setLocalUpdateDate(res.data.update_date);
          }
          track(AnalyticsEvent.ActivityContentSaved, {
            new_version: res.data?.current_version,
            had_conflict: false,
          });
          return res;
        }),
        {
          loading: t('editor.saving'),
          success: () => <b>{t('editor.saved')}</b>,
          error: (err) => {
            const errorMessage = err?.data?.detail || err?.data?.message || t('editor.save_error');
            return <b>{errorMessage}</b>;
          },
        }
      )
      return { hasConflict: false, result };
    } catch {
      // toast.promise already showed the error toast; return a non-throwing failure result
      return { hasConflict: false, result: null };
    }
  }

  return (
    <>
      <Toast></Toast>
      <OrgProvider orgslug={props.org.slug}>
        {!session.isLoading && (
          <Editor
            key={liveSession ? 'live' : manualSave ? 'manual' : 'autosave'}
            collab={liveSession}
            saveMode={manualSave ? 'manual' : 'auto'}
            liveEditing={{ mode: liveMode, orgDefault, onChange: setActivityLiveMode }}
            readOnly={!manualSave && !liveSession && collab.phase === 'connecting' && !graceOver}
            connecting={!manualSave && !liveSession && collab.phase === 'connecting'}
            onLegacyHandle={onLegacyHandle}
            handoverSelection={handoverSelection}
            org={props.org}
            course={props.course}
            activity={props.activity}
            content={contentOverride ?? normalizedContent}
            setContent={setContent}
            session={session}
            checkForConflicts={checkForConflicts}
            fetchRemoteContent={fetchRemoteContent}
            localVersion={localVersion}
            onReady={props.onEditorReady}
          />
        )}
      </OrgProvider>
    </>
  )
}

export default EditorWrapper