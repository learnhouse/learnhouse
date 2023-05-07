
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
  const courses = await getOrgCourses(orgslug);

  return (
    <div>
      <Courses orgslug={orgslug} courses={courses}/>
    </div>
  );
};

export default CoursesPage;

