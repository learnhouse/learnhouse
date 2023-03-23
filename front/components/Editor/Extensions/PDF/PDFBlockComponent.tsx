import { NodeViewWrapper } from "@tiptap/react";
import React from "react";
import styled from "styled-components";
import { AlertCircle, AlertTriangle, FileText, Image, ImagePlus, Info } from "lucide-react";
import { getPDFFile, uploadNewPDFFile } from "../../../../services/blocks/Pdf/pdf";
import { getBackendUrl } from "../../../../services/config";

function PDFBlockComponent(props: any) {
  const [pdf, setPDF] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [blockObject, setblockObject] = React.useState(props.node.attrs.blockObject);

  const handlePDFChange = (event: React.ChangeEvent<any>) => {
    setPDF(event.target.files[0]);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsLoading(true);
    let object = await uploadNewPDFFile(pdf, props.extension.options.lecture.lecture_id);
    setIsLoading(false);
    setblockObject(object);
    props.updateAttributes({
      blockObject: object,
    });
  };

  return (
    <NodeViewWrapper className="block-pdf">
      {!blockObject && (
        <BlockPDFWrapper contentEditable={props.extension.options.editable}>
          <div>
            <FileText color="#e1e0e0" size={50} />
            <br />
          </div>
          <input onChange={handlePDFChange} type="file" name="" id="" />
          <br />
          <button onClick={handleSubmit}>Submit</button>
        </BlockPDFWrapper>
      )}
      {blockObject && (
        <BlockPDF>
          <iframe
            src={`${getBackendUrl()}content/uploads/files/lectures/${props.extension.options.lecture.lecture_id}/blocks/pdfBlock/${blockObject.block_id}/${blockObject.block_data.file_id}.${
              blockObject.block_data.file_format
            }`}
          />
        </BlockPDF>
      )}
      {isLoading && (
        <div>
          <AlertTriangle color="#e1e0e0" size={50} />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export default PDFBlockComponent;

const BlockPDFWrapper = styled.div`
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

const BlockPDF = styled.div`
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
const PDFNotFound = styled.div``;
