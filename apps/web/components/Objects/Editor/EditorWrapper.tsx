'use client'
import { default as React } from 'react'
import * as Y from 'yjs'
import Editor from './Editor'
import { updateActivity } from '@services/courses/activities'
import { toast } from 'react-hot-toast'
import Toast from '@components/StyledElements/Toast/Toast'
import { OrgProvider } from '@components/Contexts/OrgContext'

interface EditorWrapperProps {
  content: string
  activity: any
  course: any
  org: any
}

function EditorWrapper(props: EditorWrapperProps): JSX.Element {
  // A new Y document
  const ydoc = new Y.Doc()
  const [providerState, setProviderState] = React.useState<any>({})
  const [ydocState, setYdocState] = React.useState<any>({})
  const [isLoading, setIsLoading] = React.useState(true)

  function createRTCProvider() {
    // const provider = new WebrtcProvider(props.activity.activity_id, ydoc);
    // setYdocState(ydoc);
    // setProviderState(provider);
    setIsLoading(false)
  }

  async function setContent(content: any) {
    let activity = props.activity
    activity.content = content

    toast.promise(updateActivity(activity, activity.activity_uuid), {
      loading: 'Saving...',
      success: <b>Activity saved!</b>,
      error: <b>Could not save.</b>,
    })
  }

  if (isLoading) {
    createRTCProvider()
    return <div>Loading...</div>
  } else {
    return (
      <>
        <Toast></Toast>
        <OrgProvider orgslug={props.org.slug}>
          <Editor
            org={props.org}
            course={props.course}
            activity={props.activity}
            content={props.content}
            setContent={setContent}
            provider={providerState}
            ydoc={ydocState}
          ></Editor>
          ;
        </OrgProvider>
      </>
    )
  }
}

export default EditorWrapper
