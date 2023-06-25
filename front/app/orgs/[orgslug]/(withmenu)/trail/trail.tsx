"use client";
import PageLoading from "@components/Objects/Loaders/PageLoading";
import TrailCourseElement from "@components/Pages/Trail/TrailCourseElement";
import TypeOfContentTitle from "@components/StyledElements/Titles/TypeOfContentTitle";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getAPIUrl } from "@services/config/config";
import { removeCourse } from "@services/courses/activity";
import { revalidateTags, swrFetcher } from "@services/utils/ts/requests";
import React from "react";
import useSWR, { mutate } from "swr";

function Trail(params: any) {
  let orgslug = params.orgslug;
  const { data: trail, error: error } = useSWR(`${getAPIUrl()}trail/org_slug/${orgslug}/trail`, swrFetcher);


  return (
    <GeneralWrapperStyled>
      <TypeOfContentTitle title="Trail" type="tra" />
      {!trail ? (
        <PageLoading></PageLoading>
      ) : (
        <div className="space-y-6">
          {trail.courses.map((course: any) => (
            <TrailCourseElement key={trail.trail_id} orgslug={orgslug} course={course} />
          ))}

        </div>
      )}
    </GeneralWrapperStyled>
  );
}

export default Trail;




