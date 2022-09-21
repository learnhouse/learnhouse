import type { NextPage } from "next";
import { Title } from "../components/ui/styles/title";
import Layout from "../components/ui/layout";

const Home: NextPage = () => {
  return (
    <div>
      <Layout title="Index">
        <Title>Home</Title>
      </Layout>
    </div>
  );
};

export default Home;
