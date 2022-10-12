import { useRouter } from "next/router";
import React from "react";
import Layout from "../../../../components/ui/layout";
import { getCourse } from "../../../../services/courses";
import { getOrganizationContextInfo } from "../../../../services/orgs";

const CourseIdPage = () => {
  const router = useRouter();
  const { courseid } = router.query;
  const { orgslug } = router.query;

  const [isLoading, setIsLoading] = React.useState(true);
  const [courseInfo, setCourseInfo] = React.useState("") as any;

  async function fetchCourseInfo() {
    const orgid = await getOrganizationContextInfo(orgslug);
    const response = await getCourse(courseid, orgid);
    const data = await response.json();
    setCourseInfo(data);
    setIsLoading(false);
  }

  React.useEffect(() => {
    if (router.isReady) {
      fetchCourseInfo();
    }
  }, [isLoading, router.isReady]);

  return <Layout>{isLoading ? <div>Loading...</div> : <div>{courseInfo.name}</div>}</Layout>;
};

export default CourseIdPage;
