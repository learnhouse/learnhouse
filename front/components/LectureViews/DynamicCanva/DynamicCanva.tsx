import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { styled } from "styled-components";
import Youtube from "@tiptap/extension-youtube";
// Custom Extensions
import InfoCallout from "@editor/Extensions/Callout/Info/InfoCallout";
import WarningCallout from "@editor/Extensions/Callout/Warning/WarningCallout";
import ImageBlock from "@editor/Extensions/Image/ImageBlock";
import VideoBlock from "@editor/Extensions/Video/VideoBlock";
import MathEquationBlock from "@components/Editor/Extensions/MathEquation/MathEquationBlock";
import PDFBlock from "@components/Editor/Extensions/PDF/PDFBlock";

interface Editor {
  content: string;
  lecture: any;
  //course: any;
}

function Canva(props: Editor) {
  const isEditable = false;
  const editor: any = useEditor({
    editable: isEditable,
    extensions: [
      StarterKit,
      // Custom Extensions
      InfoCallout.configure({
        editable: isEditable,
      }),
      WarningCallout.configure({
        editable: isEditable,
      }),
      ImageBlock.configure({
        editable: isEditable,
        lecture: props.lecture,
      }),
      VideoBlock.configure({
        editable: true,
        lecture: props.lecture,
      }),
      MathEquationBlock.configure({
        editable: false,
        lecture: props.lecture,
      }),
      PDFBlock.configure({
        editable: true,
        lecture: props.lecture,
      }),
      Youtube.configure({
        controls: true,
        modestBranding: true,
      }),
    ],

    content: props.content,
  });

  return (
    <CanvaWrapper>
      <EditorContent editor={editor} />
    </CanvaWrapper>
  );
}

const CanvaWrapper = styled.div`
  padding-top: 20px;
  width: 1300px;
  margin: 0 auto;
`;

export default Canva;
