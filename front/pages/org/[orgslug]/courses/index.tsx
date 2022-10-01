import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { Header } from "../../../../components/ui/header";
import Layout from "../../../../components/ui/layout";
import { Title } from "../../../../components/ui/styles/title";
import { getOrgCourses } from "../../../../services/courses";
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
              <Link href={"/org/" + orgslug + "/courses/" + removeCoursePrefix(course.course_id)}>
                <a><h2>{course.name}</h2></a>
              </Link>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
};

export default CoursesIndexPage;
