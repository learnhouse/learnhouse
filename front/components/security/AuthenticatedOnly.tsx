import React from "react";
import { getRefreshToken, getUserInfo } from "../../services/auth/auth";
import { Auth, AuthContext } from "./AuthProvider";

const AuthenticatedOnly = (props: any) => {
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
    } else {
      isAuthenticated = false;
      setAuth({ access_token, isAuthenticated, userInfo, isLoading });
    }
  }

  React.useEffect(() => {
    checkAuth();
  }, []);

  return (
    <div>
      {auth.isLoading && <div>Loading...</div>}
      {!auth.isLoading && auth.isAuthenticated && <div>{props.children}</div>}
      {!auth.isLoading && !auth.isAuthenticated && <div>Not Authenticated</div>}
    </div>
  );
};

export default AuthenticatedOnly;
