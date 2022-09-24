import type { NextPage } from "next";
import { Title } from "../components/ui/styles/title";
import Layout from "../components/ui/layout";
import { Header } from "../components/ui/header";

const Home: NextPage = () => {
  return (
    <div>
      <Layout title="Index">
      <Header></Header>
        <Title>Home</Title>
      </Layout>
    </div>
  );
};

export default Home;
