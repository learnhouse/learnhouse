import { NodeViewWrapper } from "@tiptap/react";
import React from "react";
import styled from "styled-components";
import { AlertCircle, AlertTriangle, Image, ImagePlus, Info } from "lucide-react";
import { getImageFile, uploadNewImageFile } from "../../../../services/files/images";
import { getBackendUrl } from "../../../../services/config";

function ImageBlockComponent(props: any) {
  const [image, setImage] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [fileObject, setfileObject] = React.useState(props.node.attrs.fileObject);

  const handleImageChange = (event: React.ChangeEvent<any>) => {
    setImage(event.target.files[0]);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsLoading(true);
    let object = await uploadNewImageFile(image, props.extension.options.lecture.lecture_id);
    setIsLoading(false);
    setfileObject(object);
    props.updateAttributes({
      fileObject: object,
    });
  };

  return (
    <NodeViewWrapper className="block-image">
      {!fileObject && (
        <BlockImageWrapper contentEditable={props.extension.options.editable}>
          <div>
            <Image color="#e1e0e0" size={50} />
            <br />
          </div>
          <input onChange={handleImageChange} type="file" name="" id="" />
          <br />
          <button onClick={handleSubmit}>Submit</button>
        </BlockImageWrapper>
      )}
      {fileObject && (
        <BlockImage>
          <img
            src={`${getBackendUrl()}content/uploads/files/pictures/${props.extension.options.lecture.lecture_id}/${fileObject.file_id}.${
              fileObject.file_format
            }`}
            alt=""
          />
        </BlockImage>
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

const BlockImage = styled.div`
  display: flex;
  flex-direction: column;
  img {
    width: 100%;
    border-radius: 6px;
    height: 300px;
    // cover
    object-fit: cover;
  }
`;
const ImageNotFound = styled.div``;
