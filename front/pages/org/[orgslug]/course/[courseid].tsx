import { useRouter } from "next/router";
import React from "react";
import styled from "styled-components";
import Layout from "../../../../components/ui/layout";
import { getAPIUrl, getBackendUrl } from "../../../../services/config";
import { getCourse } from "../../../../services/courses";
import { getOrganizationContextInfo } from "../../../../services/orgs";

const CourseIdPage = () => {
  const router = useRouter();
  const { courseid } = router.query;

  const [isLoading, setIsLoading] = React.useState(true);
  const [courseInfo, setCourseInfo] = React.useState({}) as any;

  async function fetchCourseInfo() {
    const course = await getCourse("course_" + courseid);

    setCourseInfo(course);
    console.log(courseInfo);

    setIsLoading(false);
  }

  React.useEffect(() => {
    if (router.isReady) {
      fetchCourseInfo();
    }
  }, [isLoading, router.isReady]);

  return (
    <Layout>
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <br></br>
          <h1>{courseInfo.name}</h1>
          <CourseWrapper>
            <img src={`${getBackendUrl()}content/uploads/img/${courseInfo.thumbnail}`} alt="" />
          </CourseWrapper>
        </div>
      )}
    </Layout>
  );
};

const CourseWrapper = styled.div`
  display: flex;
  img {
    position: absolute;
    width: 794px;
    height: 224.28px;
    

    background: url(), #d9d9d9;
    border: 1px solid rgba(255, 255, 255, 0.19);
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
  }
`;

export default CourseIdPage;
