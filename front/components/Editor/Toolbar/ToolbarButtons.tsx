import styled from "styled-components";
import { FontBoldIcon, FontItalicIcon, StrikethroughIcon, ArrowLeftIcon, ArrowRightIcon } from "@radix-ui/react-icons";

export const ToolbarButtons = ({ editor }: any) => {
  if (!editor) {
    return null;
  }

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
      <ToolSelect onChange={(e) => editor.chain().focus().toggleHeading({ level: parseInt(e.target.value) }).run() }>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
        <option value="5">Heading 5</option>
        <option value="6">Heading 6</option>
      </ToolSelect>
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
  font-size: 5px;
  margin-right: 5px;
  transition: all 0.2s ease-in-out;

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
  background: rgba(217, 217, 217, 0.24);
  border-radius: 6px;
  width: 100px;
  border: none;
  height: 25px;
  padding: 5px;
  font-size: 11px;
  font-family: "DM Sans";
  margin-right: 5px;
`;
