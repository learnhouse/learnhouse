import React, { useEffect } from "react";
import { getRefreshToken, getUserInfo } from "../../services/auth/auth";
import { useRouter } from "next/router";

export const AuthContext: any = React.createContext({});

const NON_AUTHENTICATED_ROUTES = ["/login", "/signup"];
export interface Auth {
  access_token: string;
  isAuthenticated: boolean;
  userInfo: {};
  isLoading: boolean;
}

const AuthProvider = (props: any) => {
  const router = useRouter();
  const [auth, setAuth] = React.useState<Auth>({ access_token: "", isAuthenticated: false, userInfo: {}, isLoading: true });

  async function checkRefreshToken() {
    let data = await getRefreshToken();
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

        // if user is authenticated and tries to access login or signup page, redirect to home
        if (NON_AUTHENTICATED_ROUTES.includes(router.pathname)) {
          router.push("/");
        }
      } else {
        setAuth({ access_token, isAuthenticated: false, userInfo, isLoading });
        //router.push("/login");
      }
    } catch (error) {
      router.push("/");
    }
  }

  useEffect(() => {
    if (auth.isLoading) {
      checkAuth();
    }
    return () => {
      auth.isLoading = false;
    };
  }, []);

  return <AuthContext.Provider value={auth}>{props.children}</AuthContext.Provider>;
};

export default AuthProvider;
