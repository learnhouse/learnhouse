'use client';
import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { AuthContext } from "../../Security/AuthProvider";
import learnhouseIcon from "public/learnhouse_icon.png";
import { ToolbarButtons } from "./Toolbar/ToolbarButtons";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import styled from "styled-components";
import { getBackendUrl, getUriWithOrg } from "@services/config/config";
import { DividerVerticalIcon, EyeOpenIcon, SlashIcon } from "@radix-ui/react-icons";
import Avvvatars from "avvvatars-react";
// extensions
import InfoCallout from "./Extensions/Callout/Info/InfoCallout";
import WarningCallout from "./Extensions/Callout/Warning/WarningCallout";
import ImageBlock from "./Extensions/Image/ImageBlock";
import Youtube from "@tiptap/extension-youtube";
import VideoBlock from "./Extensions/Video/VideoBlock";
import { Eye, Save } from "lucide-react";
import MathEquationBlock from "./Extensions/MathEquation/MathEquationBlock";
import PDFBlock from "./Extensions/PDF/PDFBlock";
import QuizBlock from "./Extensions/Quiz/QuizBlock";
import ToolTip from "@components/StyledElements/Tooltip/Tooltip";
import Link from "next/link";

interface Editor {
  content: string;
  ydoc: any;
  provider: any;
  activity: any;
  orgslug: string
  course: any;
  setContent: (content: string) => void;
}

function Editor(props: Editor) {
  const auth: any = React.useContext(AuthContext);
  // remove course_ from course_id
  const course_id = props.course.course.course_id.substring(7);

  // remove activity_ from activity_id
  const activity_id = props.activity.activity_id.substring(9);

  const editor: any = useEditor({
    editable: true,

    extensions: [
      StarterKit.configure({
        // The Collaboration extension comes with its own history handling
        // history: false,
      }),
      InfoCallout.configure({
        editable: true,
      }),
      WarningCallout.configure({
        editable: true,
      }),
      ImageBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      VideoBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      MathEquationBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      PDFBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      QuizBlock.configure({
        editable: true,
        activity: props.activity,
      }),
      Youtube.configure({
        controls: true,
        modestBranding: true,
      }),
      // Register the document with Tiptap
      // Collaboration.configure({
      //   document: props.ydoc,
      // }),
      // Register the collaboration cursor extension
      // CollaborationCursor.configure({
      //   provider: props.provider,
      //   user: {
      //     name: auth.userInfo.username,
      //     color: "#f783ac",
      //   },
      // }),
    ],

    content: props.content,
  });

  return (
    <Page>
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
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
              <Link href="/">
                <EditorInfoLearnHouseLogo width={25} height={25} src={learnhouseIcon} alt="" />
              </Link>
              <Link target="_blank" href={`/course/${course_id}`}>
                <EditorInfoThumbnail src={`${getBackendUrl()}content/uploads/img/${props.course.course.thumbnail}`} alt=""></EditorInfoThumbnail>
              </Link>
              <EditorInfoDocName>
                {" "}
                <b>{props.course.course.name}</b> <SlashIcon /> {props.activity.name}{" "}
              </EditorInfoDocName>

            </EditorInfoWrapper>
            <EditorButtonsWrapper>
              <ToolbarButtons editor={editor} />
            </EditorButtonsWrapper>
          </EditorDocSection>
          <EditorUsersSection>
            <EditorUserProfileWrapper>
              {!auth.isAuthenticated && <span>Loading</span>}
              {auth.isAuthenticated && <Avvvatars value={auth.userInfo.user_object.user_id} style="shape" />}
            </EditorUserProfileWrapper>
            <DividerVerticalIcon style={{ marginTop: "auto", marginBottom: "auto", color: "grey" }} />
            <EditorLeftOptionsSection>
              <EditorLeftOptionsSaveButton onClick={() => props.setContent(editor.getJSON())}> Save </EditorLeftOptionsSaveButton>
              <ToolTip content="Preview"><Link target="_blank" href={`/course/${course_id}/activity/${activity_id}`}><EditorLeftOptionsPreviewButton> <Eye size={15} /> </EditorLeftOptionsPreviewButton></Link></ToolTip>
            </EditorLeftOptionsSection>
          </EditorUsersSection>
        </EditorTop>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
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
    </Page>
  );
}

const Page = styled.div`
  height: 100vh;
  width: 100%;
  min-height: 100vh;
  min-width: 100vw;
  padding-top: 30px;

  // dots background
  background-image: radial-gradient(#4744446b 1px, transparent 1px), radial-gradient(#4744446b 1px, transparent 1px);
  background-position: 0 0, 25px 25px;
  background-size: 50px 50px;
  background-attachment: fixed;
  background-repeat: repeat;
`;

const EditorTop = styled.div`
  background-color: #ffffffeb;
  border-radius: 15px;
  backdrop-filter: saturate(180%) blur(14px);
  margin: 40px;
  margin-top: 0px;
  margin-bottom: 20px;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
  position: fixed;
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
  flex-direction: row;
  justify-content: center;
  align-items: center;
`;

const EditorLeftOptionsSection = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
`;

const EditorLeftOptionsSaveButton = styled.button`
  background-color: #8783f7;
  border-radius: 8px;
  border: none;
  color: white;
  padding: 8px;
  margin-left: 10px;
  margin-right: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  outline: none;


  &:hover {
    background-color: #4a44f9;
    opacity: 0.8;
  }
`;

const EditorLeftOptionsPreviewButton = styled.button`
   background-color: #a4a4a449;
  border-radius: 8px;
  border: none;
  color: #000000;
  padding: 8px;
  margin-right: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  outline: none;

  // center icon
  display: flex;
  justify-content: center;
  align-items: center;

  &:hover {
    background-color: #c0bfbf;
    opacity: 0.8;
  }

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
  margin-right: 0px;
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
  border-radius: 8px;
  padding: 5px;
  font-size: 12px;
  margin-right: 5px;
  margin-left: 7px;
  background: #ffffff8d;
  color: #5252528d;
  border: solid 1px #52525257;
  align-items: center;
  justify-content: space-between;
  width: 53px;

  &.is-active {
    background: rgba(176, 176, 176, 0.5);

    &:hover {
      background: rgba(31, 31, 31, 0.5);
      cursor: pointer;
    }
  }

  &:hover {
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

  &:hover {
    cursor: pointer;
  }
`;

export const EditorContentWrapper = styled.div`
  margin: 40px;
  margin-top: 90px;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);

  // disable chrome outline

  .ProseMirror {

    h1 {
      font-size: 30px;  
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    h2 {
      font-size: 25px;
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    h3 {
      font-size: 20px;
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    h4 {
      font-size: 18px;
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    h5 {
      font-size: 16px;
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    padding-left: 20px;
    padding-right: 20px;
    padding-bottom: 20px;
    padding-top: 20px;

    &:focus {
      outline: none !important;
      outline-style: none !important;
      box-shadow: none !important;
    }
  }

  iframe {
    border-radius: 6px;
    border: none;
    min-width: 200px;
    width: 100%;
    height: 440px;
    min-height: 200px;
    display: block;
    outline: 0px solid transparent;
  }
`;

export default Editor;
