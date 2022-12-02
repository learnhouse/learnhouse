import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { AuthContext } from "../Security/AuthProvider";
import { ToolbarButtons } from "./Toolbar/ToolbarButtons";

interface Editor {
  content: string;
  ydoc: any;
  provider: any;
  setContent: (content: string) => void;
}

function Editor(props: Editor) {
  const auth: any = React.useContext(AuthContext);

  const editor : any = useEditor({
    extensions: [
      StarterKit.configure({
        // The Collaboration extension comes with its own history handling
        history: false,
      }),
      // Register the document with Tiptap
      Collaboration.configure({
        document: props.ydoc,
      }),
      // Register the collaboration cursor extension
      CollaborationCursor.configure({
        provider: props.provider,
        user: {
          name: auth.userInfo.username,
          color: "#f783ac",
        },
      }),
    ],

    content: props.content,
  });

  return (
    <div>
      File <button onClick={() => props.setContent(editor.getJSON())}>save</button>
      <br /><hr />
      <ToolbarButtons editor={editor} />
      <EditorContent editor={editor} style={{ backgroundColor: "white" }} />
    </div>
  );
}

export default Editor;
