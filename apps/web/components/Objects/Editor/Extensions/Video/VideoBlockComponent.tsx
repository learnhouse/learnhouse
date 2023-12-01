import { NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle, Image, Loader, Video } from "lucide-react";
import React from "react";
import styled from "styled-components";
import { getBackendUrl } from "../../../../../services/config/config";
import { uploadNewVideoFile } from "../../../../../services/blocks/Video/video";
import { getActivityBlockMediaDirectory } from "@services/media/media";
import { UploadIcon } from "@radix-ui/react-icons";

function VideoBlockComponents(props: any) {
  const [video, setVideo] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [blockObject, setblockObject] = React.useState(props.node.attrs.blockObject);
  const fileId = blockObject ? `${blockObject.block_data.file_id}.${blockObject.block_data.file_format}` : null;

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
        <BlockVideoWrapper className="flex items-center space-x-3 py-7 bg-gray-50 rounded-xl text-gray-900 px-3 border-dashed border-gray-150 border-2" contentEditable={props.extension.options.editable}>
          {isLoading ? (
            <Loader className="animate-spin animate-pulse text-gray-200" size={50} />
          ) : (
            <>
              <div>
                <Video className="text-gray-200" size={50} />
              </div>
              <input className="p-3 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 hover:file:cursor-pointer  file:bg-gray-200 cursor-pointer file:text-gray-500" onChange={handleVideoChange} type="file" name="" id="" />
              <button className='p-2 px-3 bg-gray-200 rounded-lg text-gray-500 hover:bg-gray-300 transition space-x-2 items-center flex' onClick={handleSubmit}><UploadIcon></UploadIcon><p>Submit</p></button>
            </>
          )}
        </BlockVideoWrapper>
      )}
      {blockObject && (
        <BlockVideo>
          <video
            controls
            className="rounded-lg shadow h-96 w-full object-scale-down bg-black"
            src={`${getActivityBlockMediaDirectory(props.extension.options.activity.org_id,
              props.extension.options.activity.course_uuid,
              props.extension.options.activity.activity_id,
              blockObject.block_id,
              blockObject ? fileId : ' ', 'videoBlock')}`}
          ></video>
        </BlockVideo>
      )}

    </NodeViewWrapper>
  );
}
const BlockVideoWrapper = styled.div`
  
  //border: ${(props) => (props.contentEditable ? "2px dashed #713f1117" : "none")};

  // center
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;
`;

const BlockVideo = styled.div`
  display: flex;
  flex-direction: column;
`;
export default VideoBlockComponents;
