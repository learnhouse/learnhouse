import { getBackendUrl } from "@services/config/config";
import { getActivityMediaDirectory } from "@services/media/media";
import React from "react";

function DocumentPdfActivity({ activity, course }: { activity: any; course: any }) {

  return (
    <div className="m-8 bg-zinc-900 rounded-md mt-14">
      <iframe
        className="rounded-lg w-full h-[900px]"
        src={getActivityMediaDirectory(activity.org_id, activity.course_uuid, activity.activity_id, activity.content.documentpdf.filename, 'documentpdf')}
      />
    </div>
  );
}

export default DocumentPdfActivity;


