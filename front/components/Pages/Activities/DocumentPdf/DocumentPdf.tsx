import { getBackendUrl } from "@services/config/config";
import React from "react";

function DocumentPdfActivity({ activity, course }: { activity: any; course: any }) {
  
  return (
    <div className="m-8 bg-zinc-900 rounded-md mt-14">
      <iframe
        className="rounded-lg w-full h-[900px]"
        src={`${getBackendUrl()}content/uploads/documents/documentpdf/${activity.content.documentpdf.activity_id}/${activity.content.documentpdf.filename}`}
      />
    </div>
  );
}

export default DocumentPdfActivity;


