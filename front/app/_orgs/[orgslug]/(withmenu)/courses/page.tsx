"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import styled from "styled-components";
import { Title } from "@components/UI/Elements/Styles/Title";
import { getAPIUrl, getBackendUrl, getSelfHostedOption, getUriWithOrg } from "@services/config/config";
import { deleteCourseFromBackend } from "@services/courses/courses";
import useSWR, { mutate } from "swr";
import { swrFetcher } from "@services/utils/ts/requests";
import { Edit2, Trash } from "lucide-react";

const CoursesIndexPage = (params: any) => {
  const router = useRouter();
  const orgslug = params.params.orgslug;

  const { data: courses, error: error } = useSWR(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`, swrFetcher);

  async function deleteCourses(course_id: any) {
    await deleteCourseFromBackend(course_id);
    mutate(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`);
  }

  // function to remove "course_" from the course_id
  function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
  }
  
  return (
    <>
      <Title>
        Courses :{" "}
        <Link href={getUriWithOrg(orgslug, "/courses/new")}>
          <button>+</button>
        </Link>{" "}
      </Title>
      {error && <p>Failed to load</p>}
      {!courses ? (
        <div>Loading...</div>
      ) : (
        <CourseWrapper>
          {courses.map((course: any) => (
            <div key={course.course_id}>
              <button style={{ backgroundColor: "red", border: "none" }} onClick={() => deleteCourses(course.course_id)}>
                Delete <Trash size={10}></Trash>
              </button>
              <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
                <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id) + "/edit")}>
                  <button>
                    Edit <Edit2 size={10}></Edit2>
                  </button>
                </Link>
                <CourseThumbnail>
                  <img src={`${getBackendUrl()}content/uploads/img/${course.thumbnail}`} alt="" />
                </CourseThumbnail>
                <h2>{course.name}</h2>
              </Link>
            </div>
          ))}
        </CourseWrapper>
      )}
    </>
  );
};

export default CoursesIndexPage;

const CourseThumbnail = styled.div`
  display: flex;
  img {
    width: 249px;
    height: 131px;

    background: url(), #d9d9d9;
    border: 1px solid rgba(255, 255, 255, 0.19);
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
  }
`;

const CourseWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin: 0 auto;
  max-width: 1500px;
  div {
    h2 {
      margin: 0;
      padding: 0;
      margin-top: 10px;
      font-size: 18px;
      font-weight: 600;
      width: 250px;
      height: 50px;
      color: #424242;
    }
    button {
      margin: 4px 0;
      border: none;
      border-radius: 7px;
      background: #000000;
      opacity: 0.4;
      font-family: "DM Sans", sans-serif;

      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
  }
`;
