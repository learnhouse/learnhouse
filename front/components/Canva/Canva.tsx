import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
// Custom Extensions
import InfoCallout from "../Editor/Extensions/Callout/Info/InfoCallout";

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
    ],

    content: props.content,
  });

  return <EditorContent editor={editor} />;
}

export default Canva;
