import { NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle, Image, Video } from "lucide-react";
import React from "react";
import styled from "styled-components";
import { getBackendUrl } from "../../../../services/config";
import { uploadNewVideoFile } from "../../../../services/files/video";

function VideoBlockComponents(props: any) {
  const [video, setVideo] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [fileObject, setfileObject] = React.useState(props.node.attrs.fileObject);

  const handleVideoChange = (event: React.ChangeEvent<any>) => {
    setVideo(event.target.files[0]);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsLoading(true);
    let object = await uploadNewVideoFile(video, props.extension.options.element.element_id);
    setIsLoading(false);
    setfileObject(object);
    props.updateAttributes({
      fileObject: object,
    });
  };

  return (
    <NodeViewWrapper className="block-video">
      {!fileObject && (
        <BlockVideoWrapper contentEditable={props.extension.options.editable}>
          <div>
            <Video color="#e1e0e0" size={50} />
            <br />
          </div>
          <input onChange={handleVideoChange} type="file" name="" id="" />
          <br />
          <button onClick={handleSubmit}>Submit</button>
        </BlockVideoWrapper>
      )}
      {fileObject && (
        <BlockVideo>
          <video
            controls
            src={`${getBackendUrl()}content/uploads/files/videos/${props.extension.options.element.element_id}/${fileObject.file_id}.${
              fileObject.file_format
            }`}
          ></video>
        </BlockVideo>
      )}
      {isLoading && (
        <div>
          <AlertTriangle color="#e1e0e0" size={50} />
        </div>
      )}
    </NodeViewWrapper>
  );
}
const BlockVideoWrapper = styled.div`
  display: flex;
  flex-direction: column;
  background: #f9f9f9;
  border-radius: 3px;
  padding: 30px;
  min-height: 74px;
  border: ${(props) => (props.contentEditable ? "2px dashed #713f1117" : "none")};

  // center
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;
`;

const BlockVideo = styled.div`
  display: flex;
  flex-direction: column;
  video {
    width: 100%;
    border-radius: 6px;
    height: 300px;
    // cover
    object-fit: cover;
  }
`;
export default VideoBlockComponents;
