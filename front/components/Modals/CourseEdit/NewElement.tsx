import React, { useState } from "react";
import { ArrowLeftIcon, Cross1Icon } from "@radix-ui/react-icons";
import Modal from "../Modal";
import styled from "styled-components";
import DynamicCanvaModal from "./NewElementModal/DynamicCanva";
import VideoModal from "./NewElementModal/Video";

function NewElementModal({ closeModal, submitElement, submitFileElement, chapterId }: any) {
  const [selectedView, setSelectedView] = useState("home");

  return (
    <Modal>
      <button onClick={ () => {setSelectedView("home")}}>
        <ArrowLeftIcon />
      </button>
      <button onClick={closeModal}>
        <Cross1Icon />
      </button>
      <h1>Add New Element</h1>
      <br />

      {selectedView === "home" && (
        <ElementChooserWrapper>
          <ElementButton onClick={() => {setSelectedView("dynamic")}}>✨📄</ElementButton>
          <ElementButton onClick={() => {setSelectedView("video")}}>📹</ElementButton>
        </ElementChooserWrapper>
      )}

      {selectedView === "dynamic" && (
        <DynamicCanvaModal submitElement={submitElement} chapterId={chapterId} />
      )}

      {selectedView === "video" && (
        <VideoModal submitFileElement={submitFileElement} chapterId={chapterId} />
      )}
      
    </Modal>
  );
}

const ElementChooserWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 20px;
`;

const ElementButton = styled.button`
  padding: 20px;
  border-radius: 10px;
  border: none;
  font-size: 50px;
  background-color: #8c949c33;
  cursor: pointer;
  &:hover {
    background-color: #8c949c7b;
  }
`;

export default NewElementModal;
