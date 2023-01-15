import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
// Custom Extensions
import InfoCallout from "@editor/Extensions/Callout/Info/InfoCallout";
import WarningCallout from "@editor/Extensions/Callout/Warning/WarningCallout";
import ImageBlock from "@editor/Extensions/Image/ImageBlock";
import Youtube from "@tiptap/extension-youtube";
import { EditorContentWrapper } from "@editor/Editor";
import VideoBlock from "@editor/Extensions/Video/VideoBlock";
import { styled } from "styled-components";

interface Editor {
  content: string;
  element: any;
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
        element: props.element,
      }),
      VideoBlock.configure({
        editable: true,
        element: props.element,
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
