
import React from "react";
import Courses from "./courses";
import { getOrgCourses } from "@services/courses/courses";
import { Metadata } from "next";
import { getOrganizationContextInfo } from "@services/organizations/orgs";

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
  const courses = await getOrgCourses(orgslug, { revalidate: 0, tags: ['courses'] });

  return (
    <div>
      <Courses orgslug={orgslug} courses={courses} />
    </div>
  );
};

export default CoursesPage;

