"use client";
import React from "react";
import styled from "styled-components";
import Link from "next/link";
import Avvvatars from "avvvatars-react";
import { GearIcon } from "@radix-ui/react-icons";
import { getNewAccessTokenUsingRefreshToken, getUserInfo } from "@services/auth/auth";
import { usePathname } from "next/navigation";
import { useRouter } from "next/router";
import path from "path";

export interface Auth {
  access_token: string;
  isAuthenticated: boolean;
  userInfo: any;
  isLoading: boolean;
}

function ProfileArea() {


  const PRIVATE_ROUTES = ["/course/*/edit", "/settings*", "/trail"];
  const NON_AUTHENTICATED_ROUTES = ["/login", "/register"];


  const router = useRouter();
  const pathname = usePathname();
  const [auth, setAuth] = React.useState<Auth>({ access_token: "", isAuthenticated: false, userInfo: {}, isLoading: true });

  async function checkRefreshToken() {
    let data = await getNewAccessTokenUsingRefreshToken();
    if (data) {
      return data.access_token;
    }
  }

  React.useEffect(() => {
    checkAuth();
    console.log("pathname", pathname);
  }, [pathname]);

  async function checkAuth() {
    try {
      let access_token = await checkRefreshToken();
      let userInfo = {};
      let isLoading = false;

      if (access_token) {
        userInfo = await getUserInfo(access_token);
        setAuth({ access_token, isAuthenticated: true, userInfo, isLoading });

        // Redirect to home if user is trying to access a NON_AUTHENTICATED_ROUTES route

        if (NON_AUTHENTICATED_ROUTES.some((route) => new RegExp(`^${route.replace("*", ".*")}$`).test(pathname))) {
          router.push("/");
        }


      } else {
        setAuth({ access_token, isAuthenticated: false, userInfo, isLoading });

        // Redirect to login if user is trying to access a private route
        if (PRIVATE_ROUTES.some((route) => new RegExp(`^${route.replace("*", ".*")}$`).test(pathname))) {
          router.push("/login");
        }

      }
    } catch (error) {

    }
  }
  return (
    <ProfileAreaStyled>
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
          <Link href={"/settings"}><GearIcon /></Link>
        </AccountArea>
      )}
    </ProfileAreaStyled>
  )
}

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

const ProfileAreaStyled = styled.div`
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


export default ProfileArea