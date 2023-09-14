import styled from "styled-components";
import { FontBoldIcon, FontItalicIcon, StrikethroughIcon, ArrowLeftIcon, ArrowRightIcon, OpacityIcon, DividerVerticalIcon, ListBulletIcon } from "@radix-ui/react-icons";
import { AlertCircle, AlertTriangle, FileText, GraduationCap, HelpCircle, ImagePlus, Info, Sigma, Video, Youtube } from "lucide-react";
import ToolTip from "@components/StyledElements/Tooltip/Tooltip";

export const ToolbarButtons = ({ editor, props }: any) => {
  if (!editor) {
    return null;
  }

  // YouTube extension

  const addYoutubeVideo = () => {
    const url = prompt("Enter YouTube URL");

    if (url) {
      editor.commands.setYoutubeVideo({
        src: url,
        width: 640,
        height: 480,
      });
    }
  };

  return (
    <ToolButtonsWrapper>
      <ToolBtn onClick={() => editor.chain().focus().undo().run()}>
        <ArrowLeftIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()}>
        <ArrowRightIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "is-active" : ""}>
        <FontBoldIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive("italic") ? "is-active" : ""}>
        <FontItalicIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive("strike") ? "is-active" : ""}>
        <StrikethroughIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'is-active' : ''}>
        <ListBulletIcon />
      </ToolBtn>
      <ToolSelect
        onChange={(e) =>
          editor
            .chain()
            .focus()
            .toggleHeading({ level: parseInt(e.target.value) })
            .run()
        }
      >
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
        <option value="5">Heading 5</option>
        <option value="6">Heading 6</option>
      </ToolSelect>
      {/* TODO: fix this : toggling only works one-way */}
      <DividerVerticalIcon style={{ marginTop: "auto", marginBottom: "auto", color: "grey" }} />
      <ToolTip content={"Info Callout"}>
        <ToolBtn onClick={() => editor.chain().focus().toggleNode("calloutInfo").run()}>
          <AlertCircle size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={"Warning Callout"}>
        <ToolBtn onClick={() => editor.chain().focus().toggleNode("calloutWarning").run()}>
          <AlertTriangle size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={"Image"}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "blockImage",
              })
              .run()
          }
        >
          <ImagePlus size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip
        content={"Video"}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "blockVideo",
              })
              .run()
          }
        >
          <Video size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={"YouTube video"}>
        <ToolBtn onClick={() => addYoutubeVideo()}>
          <Youtube size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={"Math Equation (LaTeX)"}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "blockMathEquation",
              })
              .run()
          }
        >
          <Sigma size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={"PDF Document"}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "blockPDF",
              })
              .run()
          }
        >
          <FileText size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={"Interactive Quiz"}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "blockQuiz",
              })
              .run()
          }
        >
          <HelpCircle size={15} />
        </ToolBtn>
      </ToolTip>
    </ToolButtonsWrapper>
  );
};

const ToolButtonsWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: left;
  justify-content: left;
`;

const ToolBtn = styled.div`
  display: flex;
  background: rgba(217, 217, 217, 0.24);
  border-radius: 6px;
  width: 25px;
  height: 25px;
  padding: 5px;
  margin-right: 5px;
  transition: all 0.2s ease-in-out;

  svg {
    padding: 1px;
  }

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

const ToolSelect = styled.select`
  display: flex;
  background: rgba(217, 217, 217, 0.185);
  border-radius: 6px;
  width: 100px;
  border: none;
  height: 25px;
  padding: 5px;
  font-size: 11px;
  font-family: "DM Sans";
  margin-right: 5px;
`;
