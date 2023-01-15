import React, { useState } from "react";

function DynamicCanvaModal({ submitLecture, chapterId }: any) {
  const [lectureName, setLectureName] = useState("");
  const [lectureDescription, setLectureDescription] = useState("");

  const handleLectureNameChange = (e: any) => {
    setLectureName(e.target.value);
  };

  const handleLectureDescriptionChange = (e: any) => {
    setLectureDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ lectureName, lectureDescription, chapterId });
    submitLecture({
      name: lectureName,
      chapterId: chapterId,
      type: "dynamic",
    });
  };
  return (
    <div>
      <div>
        <input type="text" onChange={handleLectureNameChange} placeholder="Lecture Name" /> <br />
        <input type="text" onChange={handleLectureDescriptionChange} placeholder="Lecture Description" />
        <br />
        <button onClick={handleSubmit}>Add Lecture</button>
      </div>
    </div>
  );
}

export default DynamicCanvaModal;
