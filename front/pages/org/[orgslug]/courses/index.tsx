import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import styled from "styled-components";
import { Header } from "../../../../components//UI/Header";
import Layout from "../../../../components//UI/Layout";
import { Title } from "../../../../components//UI/Elements/Styles/Title";
import { getBackendUrl } from "../../../../services/config";
import { deleteCourseFromBackend, getOrgCourses } from "../../../../services/courses/courses";
import { getOrganizationContextInfo } from "../../../../services/orgs";

const CoursesIndexPage = () => {
  const router = useRouter();
  const { orgslug } = router.query;

  const [isLoading, setIsLoading] = React.useState(true);
  const [orgInfo, setOrgInfo] = React.useState(null);
  const [courses, setCourses] = React.useState([]);

  async function fetchCourses() {
    const org = await getOrganizationContextInfo(orgslug);
    const response = await getOrgCourses(org.org_id);
    setCourses(response);
    setIsLoading(false);
  }

  async function deleteCourses(course_id: any) {
    const response = await deleteCourseFromBackend(course_id);
    const newCourses = courses.filter((course: any) => course.course_id !== course_id);
    setCourses(newCourses);
  }

  // function to remove "course_" from the course_id
  function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
  }

  React.useEffect(() => {
    if (router.isReady) {
      fetchCourses();
      if (courses.length > 0) {
        setIsLoading(false);
      }
    }
  }, [isLoading, router.isReady]);

  return (
    <Layout title="Courses">
      <Header></Header>
      <Title>
        {orgslug} courses :{" "}
        <Link href={"/org/" + orgslug + "/courses/new"}>
          <a>
            <button>+</button>
          </a>
        </Link>{" "}
      </Title>

      <hr />
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          {courses.map((course: any) => (
            <div key={course.course_id}>
              <Link href={"/org/" + orgslug + "/course/" + removeCoursePrefix(course.course_id)}>
                <a>
                  <h2>{course.name}</h2>
                  <CourseWrapper>
                    <img src={`${getBackendUrl()}content/uploads/img/${course.thumbnail}`} alt="" />
                  </CourseWrapper>
                </a>
              </Link>
              <button style={{ backgroundColor: "red", border: "none" }} onClick={() => deleteCourses(course.course_id)}>
                Delete
              </button>
              <Link href={"/org/" + orgslug + "/course/" + removeCoursePrefix(course.course_id) + "/edit"}>
                <a>
                  <button>Edit Chapters</button>
                </a>
              </Link>
            </div>
          ))}
        </div>
      )}
    </Layout>
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
