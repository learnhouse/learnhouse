import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
// Custom Extensions
import InfoCallout from "../Editor/Extensions/Callout/Info/InfoCallout";
import WarningCallout from "../Editor/Extensions/Callout/Warning/WarningCallout";
import ImageBlock from "../Editor/Extensions/Image/ImageBlock";

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
    ],

    content: props.content,
  });

  return <EditorContent editor={editor} />;
}

export default Canva;
