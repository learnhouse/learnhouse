import { NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle, Image, Video } from "lucide-react";
import React from "react";
import styled from "styled-components";
import { getBackendUrl } from "../../../../../services/config/config";
import { uploadNewVideoFile } from "../../../../../services/blocks/Video/video";

function VideoBlockComponents(props: any) {
  const [video, setVideo] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [blockObject, setblockObject] = React.useState(props.node.attrs.blockObject);

  const handleVideoChange = (event: React.ChangeEvent<any>) => {
    setVideo(event.target.files[0]);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsLoading(true);
    let object = await uploadNewVideoFile(video, props.extension.options.activity.activity_id);
    setIsLoading(false);
    setblockObject(object);
    props.updateAttributes({
      blockObject: object,
    });
  };

  return (
    <NodeViewWrapper className="block-video">
      {!blockObject && (
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
      {blockObject && (
        <BlockVideo>
          <video
            controls
            src={`${getBackendUrl()}content/uploads/files/activities/${props.extension.options.activity.activity_id}/blocks/videoBlock/${blockObject.block_id}/${blockObject.block_data.file_id}.${
              blockObject.block_data.file_format
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
