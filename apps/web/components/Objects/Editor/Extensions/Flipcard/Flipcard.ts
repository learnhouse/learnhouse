import { ReactNodeViewRenderer } from "@tiptap/react";
import { mergeAttributes, Node } from "@tiptap/core";
import FlipcardExtension from "./FlipcardExtension";

export default Node.create({
  name: "flipcard",
  group: "block",
  draggable: true,
  content: "text*",

  addAttributes() {
    return {
      question: {
        default: 'Click to reveal the answer',
      },
      answer: {
        default: 'This is the answer',
      },
      color: {
        default: 'blue',
      },
      alignment: {
        default: 'center',
      },
      size: {
        default: 'medium',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "flipcard-block",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["flipcard-block", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FlipcardExtension);
  },
});
