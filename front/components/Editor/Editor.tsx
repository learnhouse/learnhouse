import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { AuthContext } from "../Security/AuthProvider";
import learnhouseIcon from "public/learnhouse_icon.png";
import { ToolbarButtons } from "./Toolbar/ToolbarButtons";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import styled from "styled-components";
import { getBackendUrl } from "../../services/config";
import { GlobeIcon, SlashIcon } from "@radix-ui/react-icons";
import Avvvatars from "avvvatars-react";

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
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        key="modal"
        transition={{
          type: "spring",
          stiffness: 360,
          damping: 70,
          delay: 0.02,
        }}
        exit={{ opacity: 0 }}
      >
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
                <GlobeIcon></GlobeIcon>
              </EditorSaveButton>
            </EditorInfoWrapper>
            <EditorButtonsWrapper>
              <ToolbarButtons editor={editor} />
            </EditorButtonsWrapper>
          </EditorDocSection>
          <EditorUsersSection>
            <EditorUserProfileWrapper>
              <Avvvatars value={auth.userInfo.user_object.user_id} style="shape" />
            </EditorUserProfileWrapper>
          </EditorUsersSection>
        </EditorTop>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        key="modal"
        transition={{
          type: "spring",
          stiffness: 360,
          damping: 70,
          delay: 0.5,
        }}
        exit={{ opacity: 0 }}
      >
      <EditorContentWrapper>
        <EditorContent editor={editor} />
      </EditorContentWrapper>
      </motion.div>
    </div>
  );
}

const EditorTop = styled.div`
  background-color: white;
  border-radius: 15px;
  margin: 40px;
  margin-bottom: 20px;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
  //position: fixed;
  z-index: 3;
  width: -webkit-fill-available;
`;

// Inside EditorTop
const EditorDocSection = styled.div`
  display: flex;
  flex-direction: column;
`;
const EditorUsersSection = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

// Inside EditorDocSection
const EditorInfoWrapper = styled.div`
  display: flex;
  flex-direction: row;
  margin-bottom: 5px;
`;
const EditorButtonsWrapper = styled.div``;

// Inside EditorUsersSection
const EditorUserProfileWrapper = styled.div`
  padding-right: 8px;
  svg {
    border-radius: 7px;
  }
`;

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
  color: #494949;

  svg {
    margin-left: 4px;
    margin-right: 4px;
    padding: 3px;
    color: #353535;
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
  margin-top: 20px;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);

  // disable chrome outline

  .ProseMirror {
    padding-left: 20px;
    padding-right: 20px;
    padding-bottom: 6px;
    padding-top: 1px;
    &:focus {
      outline: none !important;
      outline-style: none !important;
      box-shadow: none !important;
    }
  }
`;

export default Editor;
