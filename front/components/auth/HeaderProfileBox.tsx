import React from "react";
import styled from "styled-components";
import Link from "next/link";
import { AuthContext } from "../security/AuthProvider";
import { getBackendUrl } from "../../services/config";

export const HeaderProfileBox = () => {
  const auth: any = React.useContext(AuthContext);
  
  return (
    <ProfileArea>
      {!auth.isAuthenticated && (
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
      )}
      {auth.isAuthenticated && <AccountArea>
        <div>{auth.userInfo.username}</div>
        <div><img src={`${getBackendUrl()}content/uploads/img/${auth.userInfo.avatar_url}`} alt="" /></div>
        </AccountArea>}
    </ProfileArea>
  );
};

const AccountArea = styled.div`
  padding-right: 20px;
  display: flex;
  place-items: center;

  div{
    margin-right: 10px;
  }
  img{
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
