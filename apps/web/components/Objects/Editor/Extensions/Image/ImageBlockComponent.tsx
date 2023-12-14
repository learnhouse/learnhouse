import { NodeViewWrapper } from "@tiptap/react";
import React, { useEffect } from "react";
import styled from "styled-components";
import { Resizable } from 're-resizable';
import { AlertTriangle, Image, Loader } from "lucide-react";
import { uploadNewImageFile } from "../../../../../services/blocks/Image/images";
import { UploadIcon } from "@radix-ui/react-icons";
import { getActivityBlockMediaDirectory } from "@services/media/media";
import { useOrg } from "@components/Contexts/OrgContext";
import { useCourse } from "@components/Contexts/CourseContext";

function ImageBlockComponent(props: any) {
  const org = useOrg() as any;
  const course = useCourse() as any;
  const [image, setImage] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [blockObject, setblockObject] = React.useState(props.node.attrs.blockObject);
  const [imageSize, setImageSize] = React.useState({ width: props.node.attrs.size ? props.node.attrs.size.width : 300 });
  const fileId = blockObject ? `${blockObject.content.file_id}.${blockObject.content.file_format}` : null;
  const handleImageChange = (event: React.ChangeEvent<any>) => {
    setImage(event.target.files[0]);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsLoading(true);
    let object = await uploadNewImageFile(image, props.extension.options.activity.activity_uuid);
    setIsLoading(false);
    setblockObject(object);
    props.updateAttributes({
      blockObject: object,
      size: imageSize,
    });
  };

  useEffect(() => {
  }
    , [course, org]);

  return (
    <NodeViewWrapper className="block-image">
      {!blockObject && props.extension.options.editable && (
        <BlockImageWrapper className="flex items-center space-x-3 py-7 bg-gray-50 rounded-xl text-gray-900 px-3 border-dashed border-gray-150 border-2" contentEditable={props.extension.options.editable}>
          {isLoading ? (
            <Loader className="animate-spin animate-pulse text-gray-200" size={50} />
          ) : (
            <>
              <div>
                <Image className="text-gray-200" size={50} />
              </div>
              <input className="p-3 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 hover:file:cursor-pointer  file:bg-gray-200 cursor-pointer file:text-gray-500" onChange={handleImageChange} type="file" name="" id="" />
              <button className='p-2 px-3 bg-gray-200 rounded-lg text-gray-500 hover:bg-gray-300 transition space-x-2 items-center flex' onClick={handleSubmit}><UploadIcon></UploadIcon><p>Submit</p></button>
            </>
          )}
        </BlockImageWrapper>
      )}
      {blockObject && (
        <Resizable defaultSize={{ width: imageSize.width, height: "100%" }}
          handleStyles={{
            right: { position: 'unset', width: 7, height: 30, borderRadius: 20, cursor: 'col-resize', backgroundColor: 'black', opacity: '0.3', margin: 'auto', marginLeft: 5 },

          }}
          style={{ margin: "auto", display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}
          maxWidth={1000}
          minWidth={200}
          onResizeStop={(e, direction, ref, d) => {
            props.updateAttributes({
              size: {
                width: imageSize.width + d.width,
              }
            });
            setImageSize({
              width: imageSize.width + d.width,
            });
          }}
        >

          <img
            src={`${getActivityBlockMediaDirectory(org?.org_uuid,
              course?.courseStructure.course_uuid,
              props.extension.options.activity.activity_uuid,
              blockObject.block_uuid,
              blockObject ? fileId : ' ', 'imageBlock')}`}
            alt=""
            className="rounded-lg shadow "
          />


        </Resizable>
      )}
      {isLoading && (
        <div>
          <AlertTriangle color="#e1e0e0" size={50} />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export default ImageBlockComponent;

const BlockImageWrapper = styled.div`
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;
  
`;

const BlockImage = styled.div`
  display: flex;
  

  // center
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;

  
  
`;
