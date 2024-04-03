'use client'
import { default as React, useEffect, useRef, useState } from 'react'
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
  // Define provider in the state
  const [provider, setProvider] = React.useState<HocuspocusProvider | null>(null);


  /*  Collaboration Features */
  const collab = getCollaborationServerUrl()
  const isCollabEnabledOnThisOrg = props.org.config.config.GeneralConfig.collaboration && collab
  const doc = new Y.Doc()

  // Store the Y document in the browser
  new IndexeddbPersistence(props.activity.activity_uuid, doc)


  async function setContent(content: any) {
    let activity = props.activity
    activity.content = content


    provider?.setAwarenessField("savings_states", {
      [session.user.user_uuid]: {
        status: 'action_save',
        timestamp: new Date().toISOString(),
        user: session.user
      }
    });

    toast.promise(updateActivity(activity, activity.activity_uuid), {
      loading: 'Saving...',
      success: <b>Activity saved!</b>,
      error: <b>Could not save.</b>,
    })
  }



  // Create a ref to store the last save timestamp of each user
  const lastSaveTimestampRef = useRef({}) as any;

  useEffect(() => {
    // Check if provider is not already set
    if (!provider) {
      const newProvider = new HocuspocusProvider({
        url: collab,
        name: props.activity.activity_uuid,
        document: doc,

        // TODO(alpha code): This whole block of code should be improved to something more efficient and less hacky
        onAwarenessUpdate: ({ states }) => {
          const usersStates = states;

          // Check if a user has saved the document
          usersStates.forEach((userState: any) => {
            if (userState.savings_states) {
              const savingsState = userState.savings_states

              // Check if a user has saved the document
              Object.keys(savingsState).forEach(user => {
                const userObj = savingsState[user].user;
                const status = savingsState[user].status;
                const timestamp = savingsState[user].timestamp;

                // Get the current timestamp
                const currentTimestamp = new Date().getTime();

                // If the user has saved the document and the timestamp is close to the current timestamp, show the toast
                if (status === 'action_save' && Math.abs(currentTimestamp - new Date(timestamp).getTime()) < 10) { // 5000 milliseconds = 5 seconds
                  // Update the last save timestamp for this user
                  lastSaveTimestampRef.current[user] = timestamp;

                  toast.success(`${userObj.first_name} ${userObj.last_name} has saved the document`);
                }
              });
            }
          })
        },
      });

      // Set the new provider
      setProvider(newProvider);
    }
  }, []);


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
