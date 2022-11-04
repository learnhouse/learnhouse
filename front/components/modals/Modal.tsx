import React from "react";
import styled from "styled-components";

function Modal(props: any) {
  return (
    <div>
      <Overlay>
        <Content>{props.children}</Content>
      </Overlay>
    </div>
  );
}

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 100;
`;

const Content = styled.div`
  background-color: white;
  border-radius: 5px;
  padding: 20px;
  width: 500px;
  height: 500px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
`;
export default Modal;
