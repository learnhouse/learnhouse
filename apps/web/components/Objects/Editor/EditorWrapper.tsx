'use client'
import { default as React, type JSX } from 'react';
import Editor from './Editor'
import { updateActivity } from '@services/courses/activities'
import { toast } from 'react-hot-toast'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { OrgProvider } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'

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

interface EditorWrapperProps {
  content: string
  activity: any
  course: any
  org: any
}

function EditorWrapper(props: EditorWrapperProps): JSX.Element {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;

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

  async function setContent(content: any) {
    let activity = props.activity
    activity.content = content

    toast.promise(
      updateActivity(activity, activity.activity_uuid, access_token).then(res => {
        if (!res.success) {
          throw res;
        }
        return res;
      }),
      {
        loading: 'Saving...',
        success: () => <b>Activity saved!</b>,
        error: (err) => {
          const errorMessage = err?.data?.detail || err?.data?.message || `Error ${err?.status}: Could not save`;
          return <b>{errorMessage}</b>;
        },
      }
    )
  }


  {
    return (
      <>
        <Toast></Toast>
        <OrgProvider orgslug={props.org.slug}>
          {!session.isLoading && (<Editor
            org={props.org}
            course={props.course}
            activity={props.activity}
            content={normalizedContent}
            setContent={setContent}
            session={session}
          ></Editor>)}
        </OrgProvider>
      </>
    )
  }
}



export default EditorWrapper