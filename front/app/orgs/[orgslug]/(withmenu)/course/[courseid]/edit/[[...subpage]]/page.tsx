import { getOrganizationContextInfo } from "@services/organizations/orgs";
import CourseEditClient from "./edit";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import { Metadata } from 'next';

type MetadataProps = {
  params: { orgslug: string, courseid: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {
  const cookieStore = cookies();
  const access_token_cookie: any = cookieStore.get('access_token_cookie');


  // Get Org context information 
  const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
  const course_meta = await getCourseMetadataWithAuthHeader(params.courseid, { revalidate: 0, tags: ['courses'] }, access_token_cookie ? access_token_cookie.value : null)

  return {
    title: `Edit Course - ` + course_meta.course.name,
    description: course_meta.course.mini_description,
  };
}


function CourseEdit(params: any) {
  let subpage = params.params.subpage ? params.params.subpage : 'general';
  return (
    <>
      <CourseEditClient  params={params} subpage={subpage} courseid={params.params.courseid} />
    </>
  );
}


export default CourseEdit;
