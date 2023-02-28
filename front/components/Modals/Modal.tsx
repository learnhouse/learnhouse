import React from "react";
import styled from "styled-components";
import { motion, AnimatePresence } from "framer-motion";

function Modal(props: any) {
  return (
    <div>
      <Overlay>
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, left: "50%", top: "50%", scale: 0.9, backdropFilter: "blur(10px)", y: -1, position: "absolute" }}
            animate={{ opacity: 1, left: "50%", top: "50%", scale: 1, backdropFilter: "blur(10px)", y: 0, position: "absolute" }}
            key="modal"
            transition={{
              type: "spring",
              stiffness: 360,
              damping: 70,
              delay: 0.02,
            }}
            exit={{ opacity: 0, left: "50%", top: "46%", backdropFilter: "blur(10px)", y: -1, position: "absolute" }}
          >
            <Content>{props.children}</Content>
          </motion.div>
        </AnimatePresence>
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
  z-index: 100;
  background-color: #00000029;
  backdrop-filter: blur(1px);

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
  box-shadow: 0px 64px 84px 15px rgb(0 0 0 / 10%);
`;
export default Modal;
