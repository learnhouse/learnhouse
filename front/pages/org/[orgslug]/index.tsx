import React from "react";
import { useRouter } from "next/router";
import Layout from "../../../components/ui/Layout";
import { Title } from "../../../components/ui/styles/Title";
import { Header } from "../../../components/ui/Header";
import Link from "next/link";

const OrgHomePage = () => {
  const router = useRouter();
  const { orgslug } = router.query;

  return (
    <div>
      <Layout title={"Org "+orgslug}>
        <Header></Header>
        <Title>Welcome {orgslug} 👋🏻</Title>
        <Link href={orgslug + "/courses"}>
          <a>
            <button>See Courses </button>
          </a>
        </Link>
      </Layout>
    </div>
  );
};

export default OrgHomePage;
