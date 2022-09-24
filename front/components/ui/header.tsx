import React from "react";
import { Menu } from "./elements/menu";
import Link from 'next/link'
import styled from "styled-components";


export const Header = () => {
  return (
    <div>
      <Menu></Menu>
      <PreAlphaLabel>🚧 Pre-Alpha</PreAlphaLabel>
    </div>
  );
};

const PreAlphaLabel = styled.div`
  position: fixed;
  bottom: 0;
  right: 0;
  padding: 9px;
  background-color: #080501;
  color: white;
  font-size: 19px;
  font-weight: bold;
  border-radius: 5px 0 0 0px;
  `;
