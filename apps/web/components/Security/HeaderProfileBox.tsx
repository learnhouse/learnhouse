'use client';
import React from "react";
import styled from "styled-components";
import Link from "next/link";
import { AuthContext } from "./AuthProviderDepreceated";
import Avvvatars from "avvvatars-react";
import { GearIcon } from "@radix-ui/react-icons";
import { Settings } from "lucide-react";

export const HeaderProfileBox = () => {
  const auth: any = React.useContext(AuthContext);

  return (
    <ProfileArea>
      {!auth.isAuthenticated && (
        <UnidentifiedArea className="flex text-sm text-gray-700 font-bold p-1.5 px-2 rounded-lg">
          <ul className="flex space-x-3 items-center">
            <li>
              <Link href="/login">
                Login
              </Link>
            </li>
            <li className="bg-black rounded-lg shadow-md p-2 px-3 text-white">
              <Link href="/signup">
                Sign up
              </Link>
            </li>
          </ul>
        </UnidentifiedArea>
      )}
      {auth.isAuthenticated && (
        <AccountArea className="space-x-0">
          <div className="flex items-center space-x-2">
            <div className="text-xs">{auth.userInfo.username} </div>
            <div className="py-4">
              <div className="shadow-sm rounded-xl">
              <Avvvatars radius={3} size={30} value={auth.userInfo.user_uuid} style="shape" />
              </div>
            </div>
            <Link className="text-gray-600" href={"/dash"}><Settings size={14} /></Link>
          </div>
        </AccountArea>
      )}
    </ProfileArea>
  );
};

const AccountArea = styled.div`
  display: flex;
  place-items: center;
  
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

  
`;
