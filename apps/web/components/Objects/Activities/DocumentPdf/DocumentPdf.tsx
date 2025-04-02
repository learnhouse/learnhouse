import { useOrg } from '@components/Contexts/OrgContext'
import { getActivityMediaDirectory } from '@services/media/media'
import { useEffect } from 'react'

function DocumentPdfActivity({
  activity,
  course,
}: {
  activity: any
  course: any
}) {
  const org = useOrg() as any

  useEffect(() => {}, [activity, org])

  return (
    <div className="m-8 mt-14 rounded-md bg-zinc-900">
      <iframe
        className="h-[900px] w-full rounded-lg"
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
