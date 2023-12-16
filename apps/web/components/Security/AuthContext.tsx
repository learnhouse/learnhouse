import { getNewAccessTokenUsingRefreshToken, getUserInfo } from '@services/auth/auth';
import { getAPIUrl } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';
import React, { useEffect } from 'react'
import useSWR from 'swr';

const AuthContext = React.createContext({})

type Auth = {
  access_token: string;
  isAuthenticated: boolean;
  user: any;
}

function AuthProvider({ children, orgslug }: { children: React.ReactNode, orgslug: string }) {
  const [auth, setAuth] = React.useState<Auth>({ access_token: "", isAuthenticated: false, user: {} });

  async function checkRefreshToken() {
    //deleteCookie("access_token_cookie");
    let data = await getNewAccessTokenUsingRefreshToken();
    if (data) {
      return data.access_token;
    }
  }

  async function checkAuth() {
    try {
      let access_token = await checkRefreshToken();
      let userInfo = {};

      if (access_token) {
        userInfo = await getUserInfo(access_token);
        setAuth({ access_token: access_token, isAuthenticated: true, user: userInfo });

      } else {
        setAuth({ access_token: access_token, isAuthenticated: false, user: userInfo });
      }
    } catch (error) {
      console.log(error);
    }
  }

  useEffect(() => {
    checkAuth();
  }, [])

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return React.useContext(AuthContext);
}

export default AuthProvider