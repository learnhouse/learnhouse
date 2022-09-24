import React from "react";
import styled from "styled-components";
import { HeaderProfileBox } from "../../auth/HeaderProfileBox";
import Link from "next/link";

export const Menu = () => {
  return (
    <GlobalHeader>
       
      <LogoArea>
        <Logo>
          <img style={{ width: "30px", opacity: "0.9", margin: "10px", paddingRight: "4px" }} src="./learnhouse_icon.png" alt="" />
          <Link href={"/"}>
            <a>
              <img src="./learnhouse_logo.png" alt="" />
            </a>
          </Link>
        </Logo>
        <div id="accounts"></div>
      </LogoArea>
      <SearchArea>
        <Search>
          <SearchInput placeholder="find something" type="text" />
        </Search>
      </SearchArea>
      <MenuArea>
        <ul>
          <li>Courses </li>
          <li>Collections</li>
          <li>Activity</li>
          <li>More</li>
        </ul>
      </MenuArea>
      <HeaderProfileBox></HeaderProfileBox>
    </GlobalHeader>
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

const Logo = styled.div`
  display: flex;
  place-items: center;
  padding-left: 20px;
 a{
  margin: 0;
 }
  img {
    width: 100px;
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

const SearchInput = styled.input`
  box-shadow: inset 5px 6px 16px rgba(0, 0, 0, 0.01);
  background: rgb(244 242 242 / 35%);
  border-radius: 6px;
  height: 50%;
  border: none;
  margin-top: 20px;
  margin-bottom: 20px;
  padding-left: 10px;
  color: #52525220;
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
