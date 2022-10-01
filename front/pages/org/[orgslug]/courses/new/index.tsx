import { useRouter } from "next/router";
import React from "react";
import { Header } from "../../../../../components/ui/header";
import Layout from "../../../../../components/ui/layout";
import { Title } from "../../../../../components/ui/styles/title";

const NewCoursePage = () => {
  const router = useRouter();
  const { orgslug } = router.query;

  return (
    <Layout title="New course">
      <Header></Header>
      <Title>New Course </Title>
      <hr />
      Name : <input type="text" /> <br />
      Description : <input type="text" /> <br />
      Cover Photo : <input type="file" /> <br />
      Learnings (separated by ; ) : <textarea id="story" name="story" rows={5} cols={33} /> <br />
      <button>Create</button>
    </Layout>
  );
};

export default NewCoursePage;
