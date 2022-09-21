import React from "react";
import Head from "next/head";
import { Header } from "./header";
import styled from "styled-components";

const Layout = (props: any) => {
  return (
    <div>
      <Head>
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Header></Header>
      <Main className="min-h-screen">{props.children}</Main>

      <Footer>
        <a href="" target="_blank" rel="noopener noreferrer">
          Powered by <img src="/learnhouse_logo.png" alt="Learnhouse Logo"  />
        </a>
      </Footer>
    </div>
  );
};

const Main = styled.main`
  min-height: 100vh;
`;

const Footer = styled.footer`
  display: flex;
  justify-content: center;
  margin: 20px;
  font-size: 16px;

  img{
    width: 100px;
    display: inline;
  }
`;

export default Layout;
