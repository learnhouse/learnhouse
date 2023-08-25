import { default as React, } from "react";
import { useRouter } from "next/navigation";
import AuthProvider from "@components/Security/AuthProvider";
import EditorWrapper from "@components/Objects/Editor/EditorWrapper";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/ts/requests";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { getActivityWithAuthHeader } from "@services/courses/activities";
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from "@services/auth/auth";

type MetadataProps = {
  params: { orgslug: string, courseid: string, activityid: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {
  const cookieStore = cookies();
  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  // Get Org context information 
  const course_meta = await getCourseMetadataWithAuthHeader(params.courseid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)

  return {
    title: `Edit - ${course_meta.course.name} Activity`,
    description: course_meta.course.mini_description,
  };
}

const EditActivity = async (params: any) => {
  const cookieStore = cookies();
  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  const activityid = params.params.activityid;
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;

  const courseInfo = await getCourseMetadataWithAuthHeader(courseid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
  const activity = await getActivityWithAuthHeader(activityid, { revalidate: 0, tags: ['activities'] }, access_token ? access_token : null)


  return (
    <div>
      <AuthProvider>
        <EditorWrapper orgslug={orgslug} course={courseInfo} activity={activity} content={activity.content}></EditorWrapper>
      </AuthProvider>
    </div>
  );
}

export default EditActivity;
