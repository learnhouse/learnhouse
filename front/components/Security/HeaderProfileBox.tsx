import React from "react";
import styled from "styled-components";
import Link from "next/link";
import { AuthContext } from "./AuthProvider";
import Avvvatars from "avvvatars-react";
import { GearIcon } from "@radix-ui/react-icons";

export const HeaderProfileBox = () => {
  const auth: any = React.useContext(AuthContext);

  return (
    <ProfileArea>
      {!auth.isAuthenticated && (
        <UnidentifiedArea>
          <ul>
            <li>
              <Link href="/login">
                Login
              </Link>
            </li>
            <li>
              <Link href="/signup">
                Sign up
              </Link>
            </li>
          </ul>
        </UnidentifiedArea>
      )}
      {auth.isAuthenticated && (
        <AccountArea>
          <div>{auth.userInfo.user_object.username}</div>
          <div>
            <Avvvatars value={auth.userInfo.user_object.user_id} style="shape" />
          </div>
          <Link href={"/settings"}><GearIcon/></Link>
        </AccountArea>
      )}
    </ProfileArea>
  );
};

const AccountArea = styled.div`
  padding-right: 20px;
  display: flex;
  place-items: center;

  a{
    // center the gear icon
    display: flex;
    place-items: center;
    place-content: center;
    width: 29px;
    height: 29px;
    border-radius: 19px;
    background: #F5F5F5;

    // hover effect
    &:hover{
      background: #E5E5E5;

    }
  }

  div {
    margin-right: 10px;
  }
  img {
    width: 29px;
    border-radius: 19px;
  }
`;

const ProfileArea = styled.div`
  display: flex;
  place-items: stretch;
  place-items: center;
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
