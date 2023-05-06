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
import Modal from "@components/UI/Modal/Modal";
import CreateCourseModal from "@components/Modals/Course/Create/CreateCourse";

const CoursesIndexPage = (params: any) => {
  const router = useRouter();
  const orgslug = params.params.orgslug;
  const [newCourseModal, setNewCourseModal] = React.useState(false);

  const { data: courses, error: error } = useSWR(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`, swrFetcher);

  async function deleteCourses(course_id: any) {
    await deleteCourseFromBackend(course_id);
    mutate(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`);
  }

  async function closeNewCourseModal() {
    setNewCourseModal(false);
  }

  // function to remove "course_" from the course_id
  function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
  }

  return (
    <>
      <Title>
        Courses {" "}
        <Modal
          isDialogOpen={newCourseModal}
          onOpenChange={setNewCourseModal}
          minHeight="md"
          dialogContent={<CreateCourseModal
            closeModal={closeNewCourseModal}
            orgslug={orgslug}
          ></CreateCourseModal>}
          dialogTitle="Create Course"
          dialogDescription="Create a new course"
          dialogTrigger={
            <button className="rounded-md bg-black antialiased ring-offset-purple-800 p-2 px-5 font text-sm font-bold text-white drop-shadow-lg">Add Course + </button>
          }
        />
      </Title>
      {error && <p>Failed to load</p>}
      {!courses ? (
        <div>Loading...</div>
      ) : (
        <CourseWrapper className="flex space-x-5">
          {courses.map((course: any) => (
            <div key={course.course_id}>
              <div className="flex space-x-2 py-2">
                <button className="rounded-md text-sm px-3 font-bold text-red-800 bg-red-200 w-16 flex justify-center items-center" onClick={() => deleteCourses(course.course_id)}>
                  Delete <Trash size={10}></Trash>
                </button>
                <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id) + "/edit")}>
                  <button className="rounded-md text-sm px-3 font-bold text-orange-800 bg-orange-200 w-16 flex justify-center items-center">
                    Edit <Edit2 size={10}></Edit2>
                  </button>
                </Link>
              </div>
              <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
              <CourseThumbnail className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover" style={{backgroundImage : `url(${getBackendUrl()}content/uploads/img/${course.thumbnail})`}}>
              
              </CourseThumbnail>
              </Link>
              <h2>{course.name}</h2>
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

  }
`;

const CourseWrapper = styled.div`
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
  }
`;
