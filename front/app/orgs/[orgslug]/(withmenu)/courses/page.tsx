
import React from "react";
import Courses from "./courses";
import { getOrgCoursesWithAuthHeader } from "@services/courses/courses";
import { Metadata } from "next";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { cookies } from "next/headers";

type MetadataProps = {
  params: { orgslug: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {

  // Get Org context information 
  const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
  return {
    title: "Courses — " + org.name,
    description: org.description,
  };
}

const CoursesPage = async (params: any) => {
  const orgslug = params.params.orgslug;
  const cookieStore = cookies();
  const access_token_cookie: any = cookieStore.get('access_token_cookie');
  const courses = await getOrgCoursesWithAuthHeader(orgslug, { revalidate: 0, tags: ['courses'] }, access_token_cookie ? access_token_cookie.value : null);

  return (
    <div>
      <Courses orgslug={orgslug} courses={courses} />
    </div>
  );
};

export default CoursesPage;

