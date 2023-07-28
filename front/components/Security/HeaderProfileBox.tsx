'use client';
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
        <AccountArea className="space-x-3">
          <div className="text-sm text-gray-600 p-1.5 px-2 rounded-lg">{auth.userInfo.user_object.full_name}</div>
          <div className="flex -space-x-2 items-center">
            <div className="py-4">
              <Avvvatars size={26} value={auth.userInfo.user_object.user_id} style="shape" />
            </div>
            <Link className="bg-slate-50 p-1.5 rounded-full" href={"/settings"}><GearIcon fontSize={26} /></Link>
          </div>
        </AccountArea>
      )}
    </ProfileArea>
  );
};

const AccountArea = styled.div`
  padding-right: 20px;
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
