import React from "react";

function VideoModal({ submitFileElement, chapterId }: any) {
  const [video, setVideo] = React.useState(null) as any;
  const [name, setName] = React.useState("");

  const handleVideoChange = (event: React.ChangeEvent<any>) => {
    setVideo(event.target.files[0]);
  };

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    let status = await submitFileElement(video, "video", { name, type: "video" }, chapterId);
  };

  /* TODO : implement some sort of progress bar for file uploads, it is not possible yet because i'm not using axios.
   and the actual upload isn't happening here anyway, it's in the submitFileElement function */

  return (
    <div>
      <input type="text" placeholder="video title" onChange={handleNameChange} />
      <br />
      <br />
      <input type="file" onChange={handleVideoChange} name="video" id="" />
      <br />

      <br />
      <button onClick={handleSubmit}>Send</button>
    </div>
  );
}

export default VideoModal;
