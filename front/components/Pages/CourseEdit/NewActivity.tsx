import React, { useState } from "react";
import { ArrowLeftIcon, Cross1Icon } from "@radix-ui/react-icons";
import DynamicPageActivityImage from "public/activities_types/dynamic-page-activity.png";
import VideoPageActivityImage from "public//activities_types/video-page-activity.png";
import { styled, keyframes } from '@stitches/react';
import DynamicCanvaModal from "./NewActivityModal/DynamicCanva";
import VideoModal from "./NewActivityModal/Video";
import Image from "next/image";

function NewActivityModal({ closeModal, submitActivity, submitFileActivity, chapterId }: any) {
  const [selectedView, setSelectedView] = useState("home");

  
  return (
    <div>
      {selectedView === "home" && (
        <ActivityChooserWrapper>
          <ActivityOption onClick={() => { setSelectedView("dynamic") }}>
            <ActivityTypeImage>
              <Image alt="Dynamic Page" src={DynamicPageActivityImage}></Image>
            </ActivityTypeImage>
            <ActivityTypeTitle>Dynamic Page</ActivityTypeTitle>
          </ActivityOption>
          <ActivityOption onClick={() => { setSelectedView("video") }}>
            <ActivityTypeImage>
              <Image alt="Video Page" src={VideoPageActivityImage}></Image>
            </ActivityTypeImage>
            <ActivityTypeTitle>Video Page</ActivityTypeTitle>
          </ActivityOption>
          <ActivityOption onClick={() => { setSelectedView("video") }}>
            <ActivityTypeImage>
              <Image alt="Video Page" src={VideoPageActivityImage}></Image>
            </ActivityTypeImage>
            <ActivityTypeTitle>Video Page</ActivityTypeTitle>
          </ActivityOption>
        </ActivityChooserWrapper>
      )}

      {selectedView === "dynamic" && (
        <DynamicCanvaModal submitActivity={submitActivity} chapterId={chapterId} />
      )}

      {selectedView === "video" && (
        <VideoModal submitFileActivity={submitFileActivity} chapterId={chapterId} />
      )}
    </div>
  );
}

const ActivityChooserWrapper = styled("div", {
  display: "flex",
  flexDirection: "row",
  justifyContent: "start",
  marginTop: 10,
});

const ActivityOption = styled("div", {
  width: "180px",
  textAlign: "center",
  borderRadius: 10,
  background: "#F6F6F6",
  border: "4px solid #F5F5F5",
  margin: "auto",

  // hover 
  "&:hover": {
    cursor: "pointer",
    background: "#ededed",
    border: "4px solid #ededed",

    transition: "background 0.2s ease-in-out, border 0.2s ease-in-out",
  },
});

const ActivityTypeImage = styled("div", {
  height: 80,
  borderRadius: 8,
  margin: 2,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "end",
  textAlign: "center",
  background: "#ffffff",

  // hover 
  "&:hover": {
    cursor: "pointer",
  },
});

const ActivityTypeTitle = styled("div", {
  display: "flex",
  fontSize: 12,
  height: "20px",
  fontWeight: 500,
  color: "rgba(0, 0, 0, 0.38);",

  // center text vertically
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",

});

export default NewActivityModal;
