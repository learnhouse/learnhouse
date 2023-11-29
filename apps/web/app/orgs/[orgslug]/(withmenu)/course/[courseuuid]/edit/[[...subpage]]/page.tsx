import { getOrganizationContextInfo } from "@services/organizations/orgs";
import CourseEditClient from "./edit";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import { Metadata } from 'next';
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from "@services/auth/auth";

type MetadataProps = {
  params: { orgslug: string, courseuuid: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {
  const cookieStore = cookies();
  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)


  // Get Org context information 
  const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
  const course_meta = await getCourseMetadataWithAuthHeader(params.courseuuid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)

  return {
    title: `Edit Course - ` + course_meta.name,
    description: course_meta.mini_description,
  };
}


async function CourseEdit(params: any) {
  const cookieStore = cookies();
  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  let subpage = params.params.subpage ? params.params.subpage : 'general';
  const course_meta = await getCourseMetadataWithAuthHeader(params.params.courseuuid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
  return (
    <>
      <CourseEditClient params={params} subpage={subpage} courseid={course_meta.id} courseuuid={params.params.courseuuid} />
    </>
  );
}


export default CourseEdit;
