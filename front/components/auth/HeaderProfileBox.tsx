import React from "react";
import styled from "styled-components";
import Link from "next/link";
import { AuthContext } from "../security/AuthProvider";

export const HeaderProfileBox = () => {
  const auth: any = React.useContext(AuthContext);

  return (
    <ProfileArea>
      {" "}
      <span>
        HeaderProfileBox <br />  isLogged : {String(auth.isAuthenticated)}  <br /> user : {String(auth.userInfo.username)}
      </span>{" "}
      <UnidentifiedArea>
        <ul>
          <li>
            <Link href="/login">
              <a>Login</a>
            </Link>
          </li>
          <li>
            <Link href="/signup">
              <a>Sign up</a>
            </Link>
          </li>
        </ul>
      </UnidentifiedArea>
    </ProfileArea>
  );
};

const ProfileArea = styled.div`
  display: flex;
  place-items: stretch;
  place-items: center;

  span {
    position: relative;
    display: block;
    top: 32px;
    right: -20px;
    padding: 6px;
    font-size: 12px;
    margin: 3px;
    // blur 
    background-color: #19191960;
    border-radius: 5px;
    color: white;
    width: auto;
  }
`;

const UnidentifiedArea = styled.div`
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
      color: #171717;
    }
  }
`;
