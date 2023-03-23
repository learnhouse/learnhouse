import React, { useState } from "react";
import { ArrowLeftIcon, Cross1Icon } from "@radix-ui/react-icons";
import Modal from "../Modal";
import styled from "styled-components";
import DynamicCanvaModal from "./NewActivityModal/DynamicCanva";
import VideoModal from "./NewActivityModal/Video";

function NewActivityModal({ closeModal, submitActivity, submitFileActivity, chapterId }: any) {
  const [selectedView, setSelectedView] = useState("home");

  return (
    <Modal>
      <button onClick={ () => {setSelectedView("home")}}>
        <ArrowLeftIcon />
      </button>
      <button onClick={closeModal}>
        <Cross1Icon />
      </button>
      <h1>Add New Activity</h1>
      <br />

      {selectedView === "home" && (
        <ActivityChooserWrapper>
          <ActivityButton onClick={() => {setSelectedView("dynamic")}}>✨📄</ActivityButton>
          <ActivityButton onClick={() => {setSelectedView("video")}}>📹</ActivityButton>
        </ActivityChooserWrapper>
      )}

      {selectedView === "dynamic" && (
        <DynamicCanvaModal submitActivity={submitActivity} chapterId={chapterId} />
      )}

      {selectedView === "video" && (
        <VideoModal submitFileActivity={submitFileActivity} chapterId={chapterId} />
      )}
      
    </Modal>
  );
}

const ActivityChooserWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 20px;
`;

const ActivityButton = styled.button`
  padding: 40px;
  border-radius: 10px !important;
  border: none;
  font-size: 80px !important;
  margin: 40px;
  background-color: #8c949c33 !important;
  cursor: pointer;
  &:hover {
    background-color: #8c949c7b;
  }
`;

export default NewActivityModal;
