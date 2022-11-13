import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { AuthContext } from "../security/AuthProvider";

interface EditorWithOptionsProps {
  content: string;
  ydoc: any;
  provider: any;
  setContent: (content: string) => void;
}

function EditorWithOptions(props: EditorWithOptionsProps) {
  const auth: any = React.useContext(AuthContext);

  const MenuBar = ({ editor }: any) => {
    if (!editor) {
      return null;
    }

    return (
      <>
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={editor.isActive("bold") ? "is-active" : ""}
        >
          bold
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={editor.isActive("italic") ? "is-active" : ""}
        >
          italic
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          className={editor.isActive("strike") ? "is-active" : ""}
        >
          strike
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={!editor.can().chain().focus().toggleCode().run()}
          className={editor.isActive("code") ? "is-active" : ""}
        >
          code
        </button>
        <button onClick={() => editor.chain().focus().unsetAllMarks().run()}>clear marks</button>
        <button onClick={() => editor.chain().focus().clearNodes().run()}>clear nodes</button>
        <button onClick={() => editor.chain().focus().setParagraph().run()} className={editor.isActive("paragraph") ? "is-active" : ""}>
          paragraph
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={editor.isActive("heading", { level: 1 }) ? "is-active" : ""}
        >
          h1
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={editor.isActive("heading", { level: 2 }) ? "is-active" : ""}
        >
          h2
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={editor.isActive("heading", { level: 3 }) ? "is-active" : ""}
        >
          h3
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          className={editor.isActive("heading", { level: 4 }) ? "is-active" : ""}
        >
          h4
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
          className={editor.isActive("heading", { level: 5 }) ? "is-active" : ""}
        >
          h5
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
          className={editor.isActive("heading", { level: 6 }) ? "is-active" : ""}
        >
          h6
        </button>
        <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive("bulletList") ? "is-active" : ""}>
          bullet list
        </button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive("orderedList") ? "is-active" : ""}>
          ordered list
        </button>
        <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive("codeBlock") ? "is-active" : ""}>
          code block
        </button>
        <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive("blockquote") ? "is-active" : ""}>
          blockquote
        </button>
        <button onClick={() => editor.chain().focus().setHorizontalRule().run()}>horizontal rule</button>
        <button onClick={() => editor.chain().focus().setHardBreak().run()}>hard break</button>
        <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().chain().focus().undo().run()}>
          undo
        </button>
        <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().chain().focus().redo().run()}>
          redo
        </button>
      </>
    );
  };

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
      <MenuBar editor={editor} />
      <EditorContent editor={editor} style={{ backgroundColor: "white" }} />
    </div>
  );
}

export default EditorWithOptions;
