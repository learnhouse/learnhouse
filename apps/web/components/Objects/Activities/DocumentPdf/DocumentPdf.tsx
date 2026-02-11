import { useOrg } from '@components/Contexts/OrgContext'
import { getActivityMediaDirectory } from '@services/media/media'
import React from 'react'

function DocumentPdfActivity({
  activity,
  course,
}: {
  activity: any
  course: any
}) {
  const org = useOrg() as any

  React.useEffect(() => {
  }, [activity, org])

  return (
    <div className="m-0 sm:m-8 bg-zinc-900 sm:rounded-md mt-0 sm:mt-14">
      <iframe
        className="sm:rounded-lg w-full h-[85vh] sm:h-[900px]"
        src={getActivityMediaDirectory(
          org?.org_uuid,
          course?.course_uuid,
          activity.activity_uuid,
          activity.content.filename,
          'documentpdf'
        )}
      />
    </div>
  )
}

export default DocumentPdfActivity
