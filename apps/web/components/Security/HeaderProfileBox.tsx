'use client';
import React, { use, useEffect } from "react";
import styled from "styled-components";
import Link from "next/link";
import Avvvatars from "avvvatars-react";
import { GearIcon } from "@radix-ui/react-icons";
import { Settings } from "lucide-react";
import { useSession } from "@components/Contexts/SessionContext";

export const HeaderProfileBox = () => {
  const session = useSession() as any;

  return (
    <ProfileArea>
      {!session.isAuthenticated && (
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
      {session.isAuthenticated && (
        <AccountArea className="space-x-0">
          <div className="flex items-center space-x-2">
            <div className="text-xs">{session.user.username} </div>
            <div className="py-4">
              <div className="shadow-sm rounded-xl">
                <Avvvatars radius={3} size={30} value={session.user.user_uuid} style="shape" />
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
