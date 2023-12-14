"use client";
import { useOrg } from "@components/Contexts/OrgContext";
import PageLoading from "@components/Objects/Loaders/PageLoading";
import TrailCourseElement from "@components/Pages/Trail/TrailCourseElement";
import TypeOfContentTitle from "@components/StyledElements/Titles/TypeOfContentTitle";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getAPIUrl } from "@services/config/config";
import { removeCourse } from "@services/courses/activity";
import { revalidateTags, swrFetcher } from "@services/utils/ts/requests";
import React, { useEffect } from "react";
import useSWR, { mutate } from "swr";

function Trail(params: any) {
  let orgslug = params.orgslug;
  const org = useOrg() as any;
  const orgID = org?.id;
  const { data: trail, error: error } = useSWR(`${getAPIUrl()}trail/org/${orgID}/trail`, swrFetcher);

  useEffect(() => {
  }
    , [trail,org]);

  return (
    <GeneralWrapperStyled>
      <TypeOfContentTitle title="Trail" type="tra" />
      {!trail ? (
        <PageLoading></PageLoading>
      ) : (
        <div className="space-y-6">
          {trail.runs.map((run: any) => (
            <>
              <TrailCourseElement run={run} course={run.course} orgslug={orgslug} />
            </>

          ))}

        </div>
      )}
    </GeneralWrapperStyled>
  );
}

export default Trail;




