'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { OrgProvider } from '@components/Contexts/OrgContext'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { updateActivity } from '@services/courses/activities'
import { type JSX, default as React } from 'react'
import { toast } from 'react-hot-toast'
import Editor from './Editor'

interface EditorWrapperProps {
  content: string
  activity: any
  course: any
  org: any
}

function EditorWrapper(props: EditorWrapperProps): JSX.Element {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  async function setContent(content: any) {
    const updatedActivity = { ...props.activity, content }

    toast.promise(
      updateActivity(
        updatedActivity,
        updatedActivity.activity_uuid,
        access_token
      ).then((res) => {
        if (!res.success) {
          throw res
        }
        return res
      }),
      {
        loading: 'Saving...',
        success: () => <b>Activity saved!</b>,
        error: (err) => {
          const errorMessage =
            err?.data?.detail ||
            err?.data?.message ||
            `Error ${err?.status}: Could not save`
          return <b>{errorMessage}</b>
        },
      }
    )
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
            content={props.content}
            setContent={setContent}
            session={session}
          ></Editor>
        )}
      </OrgProvider>
    </>
  )
}

export default EditorWrapper
