import React, { useEffect, useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

function IframeActivity({ course, activity }: { course: any; activity: any }) {
  const org = useOrg() as any
  const [iframeUrl, setIframeUrl] = useState<string>('')

  useEffect(() => {
    const fetchIframeActivity = async () => {
      try {
        const access_token = org?.access_token  // Assuming the token is in the org context
        const response = await fetch(
          `${getAPIUrl()}activities/${activity.activity_uuid}`,
          RequestBodyWithAuthHeader('GET', null, null, access_token)
        )
        const result = await response.json()

        if (result?.content?.iframe_url) {
          setIframeUrl(result.content.iframe_url)
        }
      } catch (error) {
        console.error('Error fetching iframe activity:', error)
      }
    }

    fetchIframeActivity()
  }, [activity, org])

  return (
    <div>
      {iframeUrl ? (
        <div className="m-8 bg-zinc-900 rounded-md mt-14">
          <iframe
            className="rounded-lg w-full h-[500px]"
            src={iframeUrl}
            title="Iframe Activity"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      ) : (
        <p>Loading iframe activity...</p>
      )}
    </div>
  )
}

export default IframeActivity
