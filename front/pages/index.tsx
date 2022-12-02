import type { NextPage } from "next";
import { motion } from "framer-motion";
import styled from "styled-components";
import learnhouseBigIcon from "public/learnhouse_bigicon.png";
import Image from "next/image";
import Link from "next/link";
import { PreAlphaLabel } from "../components/rename/UI/Layout";

const Home: NextPage = () => {
  return (
    <HomePage>
      <PreAlphaLabel>🚧 Pre-Alpha</PreAlphaLabel>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 260,
          damping: 70,
          delay: 0.2,
        }}
        exit={{ opacity: 1 }}
      >
        <Image alt="Learnhouse Icon" height={260} width={260} quality={100} src={learnhouseBigIcon}></Image>
      </motion.div>
      <br />
      <br />
      <br />
      <br />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 260,
          damping: 70,
          delay: 0.8,
        }}
        exit={{ opacity: 1 }}
      >
        <div>
          <Link href={"/organizations"}>
            <a>
              <OrgsButton>See Organizations</OrgsButton>
            </a>
          </Link>
          <br /><br />
          <Link href={"/login"}>
            <a>
              <OrgsButton>Login</OrgsButton>
            </a>
          </Link>
        </div>
      </motion.div>
    </HomePage>
  );
};

const OrgsButton = styled.button`
  background: #151515;
    border: 1px solid #e5e5e50a;
    box-sizing: border-box;
    border-radius: 4px;
    padding: 10px 20px;
    color: white;
    font-size: 16px;
    line-height: 24px;
    margin: 0 10px;
    margin: auto;
    cursor: pointer;
    font-family: "DM Sans";
    font-weight: 500;
    border-radius: 12px;
    -webkit-transition: all 0.2s ease-in-out;
    transition: all 0.2s ease-in-out;
  &:hover {
    background: #191919;
  }
`;

const HomePage = styled.div`
  display: flex;
  flex-direction: column;
  background: linear-gradient(131.61deg, #202020 7.15%, #000000 90.96%);
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  min-height: 100vh;
  text-align: center;
  img {
    width: 60px;
  }
`;

export default Home;
