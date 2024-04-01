'use client'
import { default as React, useEffect } from 'react'
import Editor from './Editor'
import { updateActivity } from '@services/courses/activities'
import { toast } from 'react-hot-toast'
import Toast from '@components/StyledElements/Toast/Toast'
import { OrgProvider } from '@components/Contexts/OrgContext'
import { useSession } from '@components/Contexts/SessionContext'

// Collaboration
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { LEARNHOUSE_COLLABORATION_WS_URL, getCollaborationServerUrl } from '@services/config/config'

interface EditorWrapperProps {
  content: string
  activity: any
  course: any
  org: any
}

function EditorWrapper(props: EditorWrapperProps): JSX.Element {
  const session = useSession() as any

  /*  Collaboration Features */
  const collab = getCollaborationServerUrl()
  const isCollabEnabledOnThisOrg = props.org.config.config.GeneralConfig.collaboration && collab 
  const doc = new Y.Doc()

  // Store the Y document in the browser
  new IndexeddbPersistence(props.activity.activity_uuid, doc)

  const provider = isCollabEnabledOnThisOrg ? new HocuspocusProvider({
    url: collab,
    name: props.activity.activity_uuid,
    document: doc,
    preserveConnection: false,
  }) : null
  /*  Collaboration Features */

  async function setContent(content: any) {
    let activity = props.activity
    activity.content = content

    toast.promise(updateActivity(activity, activity.activity_uuid), {
      loading: 'Saving...',
      success: <b>Activity saved!</b>,
      error: <b>Could not save.</b>,
    })
  }

  useEffect(() => {
    
  }
    , [session])


  {
    return (
      <>
        <Toast></Toast>
        <OrgProvider orgslug={props.org.slug}>
          {!session.isLoading && (<Editor
            org={props.org}
            course={props.course}
            activity={props.activity}
            content={props.content}
            setContent={setContent}
            session={session}
            ydoc={doc}
            hocuspocusProvider={provider}
            isCollabEnabledOnThisOrg={isCollabEnabledOnThisOrg}
          ></Editor>)}
        </OrgProvider>
      </>
    )
  }
}

export default EditorWrapper
