"use client";
import React from "react";
import styled from "styled-components";
import { HeaderProfileBox } from "../../Security/HeaderProfileBox";
import learnhouseIcon from "public/learnhouse_icon.png";
import learnhouseLogo from "public/learnhouse_logo.png";
import Link from "next/link";
import Image from "next/image";
import { getUriWithOrg } from "@services/config/config";
import ToolTip from "../Tooltip/Tooltip";

export const Menu = (props : any ) => {
  const orgslug = props.orgslug;
  
  
  return (
    <>
    <div className="h-[60px]"></div>
    <GlobalHeader className="backdrop-blur-lg bg-white/90 fixed top-0 left-0 right-0">
      <LogoArea>
        <Logo>
          <Image width={25} height={25} src={learnhouseIcon} alt="" />
          <Link href={getUriWithOrg(orgslug, "/")}>
            <Image width={108} height={28} src={learnhouseLogo} alt="" />
          </Link>
        </Logo>
        <div id="accounts"></div>
      </LogoArea>
      <SearchArea>
        <Search>
          <ToolTip content={<div>
            <p>{process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA}</p>  
          </div>}><PreAlphaLabel
          className="opacity-90 outline-dashed outline-2 outline-orange-200 bg-orange-100 text-orange-500"
          >pre-alpha</PreAlphaLabel></ToolTip>
        </Search>
      </SearchArea>
      <MenuArea>
        <ul>
          <li>
            <Link href={getUriWithOrg(orgslug, "/courses")}>Courses</Link>
          </li>
          <li>
            <Link href={getUriWithOrg(orgslug, "/collections")}>Collections</Link>
          </li>
          <li>
            {" "}
            <Link href={getUriWithOrg(orgslug, "/trail")}>Trail</Link>
          </li>
        </ul>
      </MenuArea>
      <HeaderProfileBox></HeaderProfileBox>
    </GlobalHeader></>
  );
};

const GlobalHeader = styled.div`
  display: flex;
  height: 60px;
  background: #ffffff;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
`;

const LogoArea = styled.div`
  display: flex;
  place-items: stretch;
`;

const PreAlphaLabel = styled.div`
  display: flex;
  place-items: center;
  background: #FF9800;
  border-radius: 6px;
  height: 50%;
  border: none;
  margin-top: 20px;
  margin-bottom: 20px;
  padding-left: 10px;
  padding-right: 10px;
  color: #ffffff;
  font-size: 12px;
  font-weight: bolder;
  text-transform: uppercase;
`;


const Logo = styled.div`
  display: flex;
  place-items: center;
  padding-left: 20px;
  a {
    margin: 0;
    padding-left: 10px;
    padding-top: 2px;
  }
`;

const SearchArea = styled.div`
  display: flex;
  place-items: stretch;
  flex-grow: 2;
`;

const Search = styled.div`
  display: flex;
  place-items: center;
  padding-left: 20px;
  width: auto;
`;



const MenuArea = styled.div`
  display: flex;
  place-items: stretch;
  flex-grow: 1;

  ul {
    display: flex;
    place-items: center;
    list-style: none;
    padding-left: 20px;

    li {
      padding-right: 20px;
      font-size: 16px;
      font-weight: 500;
      color: #525252;
    }
  }
`;
