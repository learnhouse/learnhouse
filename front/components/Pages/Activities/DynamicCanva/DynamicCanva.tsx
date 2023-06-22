import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { styled } from "styled-components";
import Youtube from "@tiptap/extension-youtube";
// Custom Extensions
import InfoCallout from "@components/Objects/Editor/Extensions/Callout/Info/InfoCallout";
import WarningCallout from "@components/Objects/Editor/Extensions/Callout/Warning/WarningCallout";
import ImageBlock from "@components/Objects/Editor/Extensions/Image/ImageBlock";
import VideoBlock from "@components/Objects/Editor/Extensions/Video/VideoBlock";
import MathEquationBlock from "@components/Objects/Editor/Extensions/MathEquation/MathEquationBlock";
import PDFBlock from "@components/Objects/Editor/Extensions/PDF/PDFBlock";

interface Editor {
  content: string;
  activity: any;
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
        activity: props.activity,
      }),
      VideoBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      MathEquationBlock.configure({
        editable: false,
        activity: props.activity,
      }),
      PDFBlock.configure({
        editable: true,
        activity: props.activity,
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
  width: 100%;
  margin: 0 auto;
`;

export default Canva;
