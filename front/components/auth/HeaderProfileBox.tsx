import React from "react";
import styled from "styled-components";
import Link from "next/link";

export const HeaderProfileBox = () => {
  return (
    <ProfileArea>
      {" "}
      <span>HeaderProfileBox</span>{" "}
      <Link href="/login">
        <a>Login</a>
      </Link>{"     "}
      <Link href="/signup">
          <a>Sign up</a>
        </Link>
    </ProfileArea>
  );
};

const ProfileArea = styled.div`
  display: flex;
  place-items: stretch;
  place-items: center;

  span {
    position: relative;
    display: block;
    top: 32px;
    right: -20px;
    padding-right: 20px;
    font-size: 12px;
    margin: 3px;
    background-color: gray;
    color: white;
    width: auto;
  }
`;
