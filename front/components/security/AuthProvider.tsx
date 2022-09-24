import React, { useEffect } from "react";
import { getRefreshToken, getUserInfo } from "../../services/auth/auth";

export const AuthContext: any = React.createContext({});

export interface Auth {
  access_token: string;
  isAuthenticated: boolean;
  userInfo: {};
  isLoading: boolean;
}

const AuthProvider = (props: any) => {
  const [auth, setAuth] = React.useState<Auth>({ access_token: "", isAuthenticated: false, userInfo: {}, isLoading: true });

  async function checkRefreshToken() {
    let data = await getRefreshToken();
    return data.access_token;
  }

  async function checkAuth() {
    let access_token = await checkRefreshToken();
    let isAuthenticated = false;
    let userInfo = {};
    let isLoading = false;

    if (access_token) {
      userInfo = await getUserInfo(access_token);
      isAuthenticated = true;
      setAuth({ access_token, isAuthenticated, userInfo, isLoading });
    } else{
      isAuthenticated = false;
      setAuth({ access_token, isAuthenticated, userInfo, isLoading });
    }
  }

   // TODO(mvp) : fix performance issues > no need to check auth on every render
  useEffect(() => {
    if (!auth.isAuthenticated) {
      checkAuth();
    }
  }, []);

  return <AuthContext.Provider value={auth}>{props.children}</AuthContext.Provider>;
};

export default AuthProvider;
