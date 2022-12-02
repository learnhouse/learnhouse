import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { AuthContext } from "../Security/AuthProvider";
import learnhouseIcon from "public/learnhouse_icon.png";
import { ToolbarButtons } from "./Toolbar/ToolbarButtons";
import Image from "next/image";
import styled from "styled-components";
import { getBackendUrl } from "../../services/config";
import { RocketIcon, SlashIcon, TriangleLeftIcon, TriangleRightIcon } from "@radix-ui/react-icons";

interface Editor {
  content: string;
  ydoc: any;
  provider: any;
  element: any;
  course: any;
  setContent: (content: string) => void;
}

function Editor(props: Editor) {
  const auth: any = React.useContext(AuthContext);
  console.log(props.element);
  console.log(props.course);

  const editor: any = useEditor({
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
      <EditorTop>
        <EditorDocSection>
          <EditorInfoWrapper>
            <EditorInfoLearnHouseLogo width={23} height={23} src={learnhouseIcon} alt="" />
            <EditorInfoThumbnail src={`${getBackendUrl()}content/uploads/img/${props.course.course.thumbnail}`} alt=""></EditorInfoThumbnail>
            <EditorInfoDocName>
              {" "}
              <b>{props.course.course.name}</b> <SlashIcon /> {props.element.name}{" "}
            </EditorInfoDocName>
            <EditorSaveButton onClick={() => props.setContent(editor.getJSON())}>
              <RocketIcon></RocketIcon>
            </EditorSaveButton>
          </EditorInfoWrapper>
          <EditorButtonsWrapper>
            <ToolbarButtons editor={editor} />
          </EditorButtonsWrapper>
        </EditorDocSection>
        <EditorUsersSection></EditorUsersSection>
      </EditorTop>
      <EditorContentWrapper>
        <EditorContent editor={editor} />
      </EditorContentWrapper>
    </div>
  );
}

const EditorTop = styled.div`
  background-color: white;
  border-radius: 15px;
  margin: 40px;
  margin-bottom: 20px;
  padding: 10px;
`;

// Inside EditorTop
const EditorDocSection = styled.div`
  display: flex;
  flex-direction: column;
`;
const EditorUsersSection = styled.div`
  display: flex;
  flex-direction: column;
`;

// Inside EditorDocSection
const EditorInfoWrapper = styled.div`
  display: flex;
  flex-direction: row;
  margin-bottom: 5px;
`;
const EditorButtonsWrapper = styled.div``;

// Inside EditorUsersSection
const EditorUserProfileWrapper = styled.div``;

// Inside EditorInfoWrapper
//..todo
const EditorInfoLearnHouseLogo = styled(Image)`
  border-radius: 6px;
  margin-right: 15px;
`;
const EditorInfoDocName = styled.div`
  font-size: 16px;
  justify-content: center;
  align-items: center;
  display: flex;
  margin-left: 10px;

  svg {
    margin-left: 4px;
    margin-right: 4px;
    color: #909090;
  }
`;

const EditorSaveButton = styled.div`
  display: flex;
  border-radius: 6px;
  width: 25px;
  height: 25px;
  padding: 5px;
  font-size: 5px;
  margin-right: 5px;
  margin-left: 7px;

  &.is-active {
    background: rgba(176, 176, 176, 0.5);

    &:hover {
      background: rgba(139, 139, 139, 0.5);
      cursor: pointer;
    }
  }

  &:hover {
    background: rgba(217, 217, 217, 0.48);
    cursor: pointer;
  }
`;

const EditorInfoThumbnail = styled.img`
  height: 25px;
  width: 56px;
  object-fit: cover;
  object-position: top;
  border-radius: 7px;
  margin-left: 5px;
`;

const EditorContentWrapper = styled.div`
  margin: 40px;
  background-color: white;

  // disable chrome outline


  .ProseMirror {
    padding: 10px;
    &:focus {
    outline: none !important;
    outline-style: none !important;
    box-shadow: none !important;
  }
  }

`;

export default Editor;
