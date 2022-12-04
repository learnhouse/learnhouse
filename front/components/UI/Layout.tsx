import React from "react";
import Head from "next/head";
import styled from "styled-components";
import AuthProvider from "../Security/AuthProvider";
import { motion } from "framer-motion";
import { Menu } from "./Elements/Menu";

const Layout = (props: any) => {
  const variants = {
    hidden: { opacity: 0, x: 0, y: 0 },
    enter: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: 0, y: 0 },
  };

  return (
    <div>
      <AuthProvider>
        <Head>
          <title>{props.title}</title>
          <meta name="description" content={props.description} />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <PreAlphaLabel>🚧 Pre-Alpha</PreAlphaLabel>
        <Menu></Menu>
        <motion.main
          variants={variants} // Pass the variant object into Framer Motion
          initial="hidden" // Set the initial state to variants.hidden
          animate="enter" // Animated state to variants.enter
          exit="exit" // Exit state (used later) to variants.exit
          transition={{ type: "linear" }} // Set the transition to linear
          className=""
        >
          <Main className="min-h-screen">{props.children}</Main>
        </motion.main>
        <Footer>
          <p>LearnHouse © 2021 - {new Date().getFullYear()} - All rights reserved</p>
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

export const PreAlphaLabel = styled.div`
  position: fixed;
  bottom: 0;
  right: 0;
  padding: 9px;
  background-color: #080501;
  color: white;
  font-size: 19px;
  font-weight: bold;
  border-radius: 5px 0 0 0px;
`;

export default Layout;
