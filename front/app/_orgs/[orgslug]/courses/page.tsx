"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import styled from "styled-components";
import { Title } from "../../../../components/UI/Elements/Styles/Title";
import { getAPIUrl, getBackendUrl } from "../../../../services/config";
import { deleteCourseFromBackend } from "../../../../services/courses/courses";
import useSWR, { mutate } from "swr";
import { swrFetcher } from "@services/utils/requests";

const CoursesIndexPage = (params: any) => {
  const router = useRouter();
  const orgslug = params.params.orgslug;

  const { data: courses, error: error } = useSWR(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`, swrFetcher);

  async function deleteCourses(course_id: any) {
    await deleteCourseFromBackend(course_id);
    mutate(`${getAPIUrl()}courses/${orgslug}/page/1/limit/10`);
  }

  // function to remove "course_" from the course_id
  function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
  }

  return (
    <>
      <Title>
        {orgslug} Courses :{" "}
        <Link href={"/courses/new"}>
          <button>+</button>
        </Link>{" "}
      </Title>

      <hr />
      {error && <p>Failed to load</p>}
      {!courses ? (
        <div>Loading...</div>
      ) : (
        <div>
          {courses.map((course: any) => (
            <div key={course.course_id}>
              <Link href={"/org/" + orgslug + "/course/" + removeCoursePrefix(course.course_id)}>
                <h2>{course.name}</h2>
                <CourseWrapper>
                  <img src={`${getBackendUrl()}content/uploads/img/${course.thumbnail}`} alt="" />
                </CourseWrapper>
              </Link>
              <button style={{ backgroundColor: "red", border: "none" }} onClick={() => deleteCourses(course.course_id)}>
                Delete
              </button>
              <Link href={"/org/" + orgslug + "/course/" + removeCoursePrefix(course.course_id) + "/edit"}>
                <button>Edit Chapters</button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default CoursesIndexPage;

const CourseWrapper = styled.div`
  display: flex;
  img {
    width: 269px;
    height: 151px;

    background: url(), #d9d9d9;
    border: 1px solid rgba(255, 255, 255, 0.19);
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
  }
`;
