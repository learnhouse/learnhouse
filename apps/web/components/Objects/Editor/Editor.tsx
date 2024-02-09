'use client';
import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import learnhouseIcon from "public/learnhouse_icon.png";
import { ToolbarButtons } from "./Toolbar/ToolbarButtons";
import { motion } from "framer-motion";
import Image from "next/image";
import styled from "styled-components";
import { DividerVerticalIcon, SlashIcon } from "@radix-ui/react-icons";
import learnhouseAI_icon from "public/learnhouse_ai_simple.png";
import { AIEditorStateTypes, useAIEditor, useAIEditorDispatch } from "@components/Contexts/AI/AIEditorContext";

// extensions
import InfoCallout from "./Extensions/Callout/Info/InfoCallout";
import WarningCallout from "./Extensions/Callout/Warning/WarningCallout";
import ImageBlock from "./Extensions/Image/ImageBlock";
import Youtube from "@tiptap/extension-youtube";
import VideoBlock from "./Extensions/Video/VideoBlock";
import { Eye } from "lucide-react";
import MathEquationBlock from "./Extensions/MathEquation/MathEquationBlock";
import PDFBlock from "./Extensions/PDF/PDFBlock";
import QuizBlock from "./Extensions/Quiz/QuizBlock";
import ToolTip from "@components/StyledElements/Tooltip/Tooltip";
import Link from "next/link";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";
import { OrderedList } from "@tiptap/extension-ordered-list";


// Lowlight
import { common, createLowlight } from 'lowlight'
const lowlight = createLowlight(common)
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import { CourseProvider } from "@components/Contexts/CourseContext";
import { useSession } from "@components/Contexts/SessionContext";
import AIEditorToolkit from "./AI/AIEditorToolkit";
import useGetAIFeatures from "@components/AI/Hooks/useGetAIFeatures";
import UserAvatar from "../UserAvatar";


interface Editor {
  content: string;
  ydoc: any;
  provider: any;
  activity: any;
  course: any;
  org: any;
  setContent: (content: string) => void;
}

function Editor(props: Editor) {
  const session = useSession() as any;
  const dispatchAIEditor = useAIEditorDispatch() as any;
  const aiEditorState = useAIEditor() as AIEditorStateTypes;
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'editor' });
  const [isButtonAvailable, setIsButtonAvailable] = React.useState(false);

  React.useEffect(() => {
    if (is_ai_feature_enabled) {
      setIsButtonAvailable(true);
    }
  }, [is_ai_feature_enabled])

  // remove course_ from course_uuid
  const course_uuid = props.course.course_uuid.substring(7);

  // remove activity_ from activity_uuid
  const activity_uuid = props.activity.activity_uuid.substring(9);

  // Code Block Languages for Lowlight
  lowlight.register('html', html)
  lowlight.register('css', css)
  lowlight.register('js', js)
  lowlight.register('ts', ts)
  lowlight.register('python', python)
  lowlight.register('java', java)

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
      OrderedList.configure(),
      CodeBlockLowlight.configure({
        lowlight,
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
        <CourseProvider courseuuid={props.course.course_uuid}>
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
            <EditorTop className="fixed bg-white bg-opacity-95 backdrop-blur backdrop-brightness-125">
              <EditorDocSection>
                <EditorInfoWrapper>
                  <Link href="/">
                    <EditorInfoLearnHouseLogo width={25} height={25} src={learnhouseIcon} alt="" />
                  </Link>
                  <Link target="_blank" href={`/course/${course_uuid}`}>
                    <EditorInfoThumbnail src={`${getCourseThumbnailMediaDirectory(props.org?.org_uuid, props.course.course_uuid, props.course.thumbnail_image)}`} alt=""></EditorInfoThumbnail>
                  </Link>
                  <EditorInfoDocName>
                    {" "}
                    <b>{props.course.name}</b> <SlashIcon /> {props.activity.name}{" "}
                  </EditorInfoDocName>
                </EditorInfoWrapper>
                <EditorButtonsWrapper>
                  <ToolbarButtons editor={editor} />
                </EditorButtonsWrapper>
              </EditorDocSection>
              <EditorUsersSection className="space-x-2">
                <div>
                  <div className="transition-all ease-linear text-teal-100 rounded-md hover:cursor-pointer" >
                    {isButtonAvailable && <div
                      onClick={() => dispatchAIEditor({ type: aiEditorState.isModalOpen ? 'setIsModalClose' : 'setIsModalOpen' })}
                      style={{
                        background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
                      }}
                      className="rounded-md px-3 py-2 drop-shadow-md flex  items-center space-x-1.5 text-sm text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out hover:scale-105">
                      {" "}
                      <i>
                        <Image className='' width={20} src={learnhouseAI_icon} alt="" />
                      </i>{" "}
                      <i className="not-italic text-xs font-bold">AI Editor</i>
                    </div>}
                  </div>
                </div>
                <DividerVerticalIcon style={{ marginTop: "auto", marginBottom: "auto", color: "grey", opacity: '0.5' }} />
                <EditorLeftOptionsSection className="space-x-2 ">
                  <div className="bg-sky-600 hover:bg-sky-700 transition-all ease-linear px-3 py-2 font-black text-sm shadow text-teal-100 rounded-lg hover:cursor-pointer" onClick={() => props.setContent(editor.getJSON())}> Save </div>
                  <ToolTip content="Preview">
                    <Link target="_blank" href={`/course/${course_uuid}/activity/${activity_uuid}`}>
                      <div className="flex bg-neutral-600 hover:bg-neutral-700 transition-all ease-linear h-9 px-3 py-2 font-black justify-center items-center text-sm shadow text-neutral-100 rounded-lg hover:cursor-pointer">
                        <Eye className="mx-auto items-center" size={15} />
                      </div>
                    </Link>
                  </ToolTip>
                </EditorLeftOptionsSection>
                <DividerVerticalIcon style={{ marginTop: "auto", marginBottom: "auto", color: "grey", opacity: '0.5' }} />

                <EditorUserProfileWrapper>
                  {!session.isAuthenticated && <span>Loading</span>}
                  {session.isAuthenticated && <UserAvatar width={40} border="border-4" rounded="rounded-full"/>}
                </EditorUserProfileWrapper>

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
              <AIEditorToolkit activity={props.activity} editor={editor} />
              <EditorContent editor={editor} />
            </EditorContentWrapper>
          </motion.div>
        </CourseProvider>
    </Page>
  );
}

const Page = styled.div`
  height: 100vh;
  width: 100%;
  padding-top: 30px;

  // dots background
  background-image: radial-gradient(#4744446b 1px, transparent 1px), radial-gradient(#4744446b 1px, transparent 1px);
  background-position: 0 0, 25px 25px;
  background-size: 50px 50px;
  background-attachment: fixed;
  background-repeat: repeat;
`;

const EditorTop = styled.div`
  border-radius: 15px;
  margin: 40px;
  margin-top: 0px;
  margin-bottom: 20px;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
  position: fixed;
  z-index: 303;
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
  z-index: 300;
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

    // Code Block
    pre {
    background: #0d0d0d;
    border-radius: 0.5rem;
    color: #fff;
    font-family: "JetBrainsMono", monospace;
    padding: 0.75rem 1rem;

    code {
      background: none;
      color: inherit;
      font-size: 0.8rem;
      padding: 0;
    }

    .hljs-comment,
    .hljs-quote {
      color: #616161;
    }

    .hljs-variable,
    .hljs-template-variable,
    .hljs-attribute,
    .hljs-tag,
    .hljs-name,
    .hljs-regexp,
    .hljs-link,
    .hljs-name,
    .hljs-selector-id,
    .hljs-selector-class {
      color: #f98181;
    }

    .hljs-number,
    .hljs-meta,
    .hljs-built_in,
    .hljs-builtin-name,
    .hljs-literal,
    .hljs-type,
    .hljs-params {
      color: #fbbc88;
    }

    .hljs-string,
    .hljs-symbol,
    .hljs-bullet {
      color: #b9f18d;
    }

    .hljs-title,
    .hljs-section {
      color: #faf594;
    }

    .hljs-keyword,
    .hljs-selector-tag {
      color: #70cff8;
    }

    .hljs-emphasis {
      font-style: italic;
    }

    .hljs-strong {
      font-weight: 700;
    }
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

  ul, ol {
    padding: 0 1rem;
    padding-left: 20px;
    list-style-type: decimal;
  }

  
  

`;

export default Editor;
