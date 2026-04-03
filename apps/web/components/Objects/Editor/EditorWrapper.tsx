'use client'
import { default as React, type JSX } from 'react';
import dynamic from 'next/dynamic'
import EditorSkeleton from './EditorSkeleton'
const Editor = dynamic(() => import('./Editor'), {
  ssr: false,
  loading: () => <EditorSkeleton />,
})
import { updateActivity, getActivityState, getActivity } from '@services/courses/activities'
import { toast } from 'react-hot-toast'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { OrgProvider } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

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
}

function EditorWrapper(props: EditorWrapperProps): JSX.Element {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;

  // Track the current version we loaded with
  const [localVersion, setLocalVersion] = React.useState<number>(
    props.activity.current_version || 1
  )
  const [localUpdateDate, setLocalUpdateDate] = React.useState<string>(
    props.activity.update_date || ''
  )

  // Normalize content to fix AI-generated mark types (strong -> bold, em -> italic)
  const normalizedContent = React.useMemo(() => {
    if (!props.content) return props.content;
    try {
      // Content might be a string (JSON) or already parsed object
      const parsed = typeof props.content === 'string'
        ? JSON.parse(props.content)
        : props.content;
      return normalizeMarkTypes(parsed);
    } catch (e) {
      // If parsing fails, return original content
      return props.content;
    }
  }, [props.content]);

  // Check for remote changes (conflict detection)
  const checkForConflicts = React.useCallback(async (): Promise<ConflictInfo | null> => {
    if (!access_token) return null;

    try {
      const remoteState = await getActivityState(
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
  }, [props.activity.activity_uuid, access_token, localVersion]);

  // Fetch remote content for merging
  const fetchRemoteContent = React.useCallback(async () => {
    if (!access_token) return null;

    try {
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
  }, [props.activity.activity_uuid, access_token]);

  async function setContent(content: any, forceOverwrite: boolean = false) {
    // Check for conflicts before saving (unless force overwrite)
    if (!forceOverwrite) {
      const conflictInfo = await checkForConflicts();
      if (conflictInfo?.hasConflict) {
        // Don't save if there's a conflict - the UI will handle this
        toast.error(
          t('editor.versioning.conflict.detected', {
            author: conflictInfo.lastModifiedBy || t('editor.versioning.conflict.another_teacher')
          })
        );
        return { hasConflict: true, conflictInfo };
      }
    }

    const result = await toast.promise(
      updateActivity({ content }, props.activity.activity_uuid, access_token).then(res => {
        if (!res.success) {
          throw res;
        }
        // Update local version after successful save
        if (res.data?.current_version) {
          setLocalVersion(res.data.current_version);
          setLocalUpdateDate(res.data.update_date);
        }
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
  }

  return (
    <>
      <Toast></Toast>
      <OrgProvider orgslug={props.org.slug}>
        {!session.isLoading && (
          <Editor
            org={props.org}
            course={props.course}
            activity={props.activity}
            content={normalizedContent}
            setContent={setContent}
            session={session}
            checkForConflicts={checkForConflicts}
            fetchRemoteContent={fetchRemoteContent}
            localVersion={localVersion}
          />
        )}
      </OrgProvider>
    </>
  )
}

export default EditorWrapper