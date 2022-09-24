import React from "react";
import Head from "next/head";
import { Header } from "./header";
import styled from "styled-components";
import AuthProvider from "../security/AuthProvider";

const Layout = (props: any) => {
  return (
    <div>
      <AuthProvider>
        <Head>
          <title>{props.title}</title>
          <meta name="description" content={props.description} />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <Header></Header>
        <Main className="min-h-screen">{props.children}</Main>

        <Footer>
          <a href="" target="_blank" rel="noopener noreferrer">
            <img src="/learnhouse_icon.png" alt="Learnhouse Logo" />
          </a>
        </Footer>
      </AuthProvider>
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

  img {
    width: 20px;
    opacity: 0.4;
    display: inline;
  }
`;

export default Layout;
