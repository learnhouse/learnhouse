import React, { useState } from "react";
import { ArrowLeftIcon, Cross1Icon } from "@radix-ui/react-icons";
import Modal from "../Modal";
import styled from "styled-components";
import DynamicCanvaModal from "./NewLectureModal/DynamicCanva";
import VideoModal from "./NewLectureModal/Video";

function NewLectureModal({ closeModal, submitLecture, submitFileLecture, chapterId }: any) {
  const [selectedView, setSelectedView] = useState("home");

  return (
    <Modal>
      <button onClick={ () => {setSelectedView("home")}}>
        <ArrowLeftIcon />
      </button>
      <button onClick={closeModal}>
        <Cross1Icon />
      </button>
      <h1>Add New Lecture</h1>
      <br />

      {selectedView === "home" && (
        <LectureChooserWrapper>
          <LectureButton onClick={() => {setSelectedView("dynamic")}}>✨📄</LectureButton>
          <LectureButton onClick={() => {setSelectedView("video")}}>📹</LectureButton>
        </LectureChooserWrapper>
      )}

      {selectedView === "dynamic" && (
        <DynamicCanvaModal submitLecture={submitLecture} chapterId={chapterId} />
      )}

      {selectedView === "video" && (
        <VideoModal submitFileLecture={submitFileLecture} chapterId={chapterId} />
      )}
      
    </Modal>
  );
}

const LectureChooserWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 20px;
`;

const LectureButton = styled.button`
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

export default NewLectureModal;
