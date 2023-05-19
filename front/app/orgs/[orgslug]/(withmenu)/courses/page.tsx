
import React from "react";
import Courses from "./courses";
import { getOrgCourses } from "@services/courses/courses";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: 'LearnHouse - Courses',
  description: 'courses',
};

const CoursesPage = async (params: any) => {
  const orgslug = params.params.orgslug;
  const courses = await getOrgCourses(orgslug, { revalidate: 360, tags: ['courses'] });

  return (
    <div>
      <Courses orgslug={orgslug} courses={courses} />
    </div>
  );
};

export default CoursesPage;

