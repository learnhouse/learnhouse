"use client";
import React, { useEffect } from "react";
import { getNewAccessTokenUsingRefreshToken, getUserInfo } from "../../services/auth/auth";
import { useRouter, usePathname } from "next/navigation";

export const AuthContext: any = React.createContext({});

const PRIVATE_ROUTES = ["/course/*/edit", "/settings*", "/trail"];
const NON_AUTHENTICATED_ROUTES = ["/login", "/register"];

export interface Auth {
  access_token: string;
  isAuthenticated: boolean;
  userInfo: {};
  isLoading: boolean;
}

const AuthProvider = ({ children }: any) => {
  const router = useRouter();
  const pathname = usePathname();

  const [auth, setAuth] = React.useState<Auth>({ access_token: "", isAuthenticated: false, userInfo: {}, isLoading: true });

  function deleteCookie(cookieName: string) {
    console.log("Deleting cookie: " + cookieName);
    document.cookie = cookieName + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  }


  async function checkRefreshToken() {
    deleteCookie("access_token_cookie");
    let data = await getNewAccessTokenUsingRefreshToken();
    if (data) {
      return data.access_token;
    }
  }


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

  useEffect(() => {
    checkRefreshToken();
    checkAuth();
    console.log("pathname", pathname);
    return () => {
      auth.isLoading = false;
    };
  }, [pathname]);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
