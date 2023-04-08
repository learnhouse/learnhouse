import React, { useState } from "react";

function NewChapterModal({ submitChapter , closeModal }: any) {
  const [chapterName, setChapterName] = useState("");
  const [chapterDescription, setChapterDescription] = useState("");

  const handleChapterNameChange = (e: any) => {
    setChapterName(e.target.value);
  };

  const handleChapterDescriptionChange = (e: any) => {
    setChapterDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ chapterName, chapterDescription });
    submitChapter({ name : chapterName, description : chapterDescription , activities : [] });
  };

  return (
    <div>
      <button onClick={closeModal}>X</button>
      <input type="text" onChange={handleChapterNameChange} placeholder="Chapter Name" /> <br />
      <input type="text" onChange={handleChapterDescriptionChange} placeholder="Chapter Description" />
      <br />
      <button onClick={handleSubmit}>Add Chapter</button>
    </div>
  );
}

export default NewChapterModal;
