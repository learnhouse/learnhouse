import React, { useState } from "react";

function DynamicCanvaModal({ submitElement, chapterId }: any) {
  const [elementName, setElementName] = useState("");
  const [elementDescription, setElementDescription] = useState("");

  const handleElementNameChange = (e: any) => {
    setElementName(e.target.value);
  };

  const handleElementDescriptionChange = (e: any) => {
    setElementDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ elementName, elementDescription, chapterId });
    submitElement({
      name: elementName,
      chapterId: chapterId,
      type: "dynamic",
    });
  };
  return (
    <div>
      <div>
        <input type="text" onChange={handleElementNameChange} placeholder="Element Name" /> <br />
        <input type="text" onChange={handleElementDescriptionChange} placeholder="Element Description" />
        <br />
        <button onClick={handleSubmit}>Add Element</button>
      </div>
    </div>
  );
}

export default DynamicCanvaModal;
