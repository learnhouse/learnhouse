import { default as React, } from "react";
import EditorWrapper from "@components/Objects/Editor/EditorWrapper";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { getActivityWithAuthHeader } from "@services/courses/activities";
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from "@services/auth/auth";
import { getOrganizationContextInfo, getOrganizationContextInfoWithId } from "@services/organizations/orgs";
import SessionProvider from "@components/Contexts/SessionContext";
import EditorOptionsProvider from "@components/Contexts/Editor/EditorContext";
import AIChatBotProvider from "@components/Contexts/AI/AIChatBotContext";
import AIEditorProvider from "@components/Contexts/AI/AIEditorContext";

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
    title: `Edit - ${course_meta.name} Activity`,
    description: course_meta.mini_description,
  };
}

const EditActivity = async (params: any) => {
  const cookieStore = cookies();
  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  const activityuuid = params.params.activityuuid;
  const courseid = params.params.courseid;
  const courseInfo = await getCourseMetadataWithAuthHeader(courseid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
  const activity = await getActivityWithAuthHeader(activityuuid, { revalidate: 0, tags: ['activities'] }, access_token ? access_token : null)
  const org = await getOrganizationContextInfoWithId(courseInfo.org_id, { revalidate: 1800, tags: ['organizations'] });

  return (
    <EditorOptionsProvider options={{ isEditable: true }}>
      <AIEditorProvider>
        <SessionProvider>
          <EditorWrapper org={org} course={courseInfo} activity={activity} content={activity.content}></EditorWrapper>
        </SessionProvider>
      </AIEditorProvider>
    </EditorOptionsProvider>
  );
}

export default EditActivity;
