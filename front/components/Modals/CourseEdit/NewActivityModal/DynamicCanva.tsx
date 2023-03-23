import React, { useState } from "react";

function DynamicCanvaModal({ submitActivity, chapterId }: any) {
  const [activityName, setActivityName] = useState("");
  const [activityDescription, setActivityDescription] = useState("");

  const handleActivityNameChange = (e: any) => {
    setActivityName(e.target.value);
  };

  const handleActivityDescriptionChange = (e: any) => {
    setActivityDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ activityName, activityDescription, chapterId });
    submitActivity({
      name: activityName,
      chapterId: chapterId,
      type: "dynamic",
    });
  };
  return (
    <div>
      <div>
        <input type="text" onChange={handleActivityNameChange} placeholder="Activity Name" /> <br />
        <input type="text" onChange={handleActivityDescriptionChange} placeholder="Activity Description" />
        <br />
        <button onClick={handleSubmit}>Add Activity</button>
      </div>
    </div>
  );
}

export default DynamicCanvaModal;
