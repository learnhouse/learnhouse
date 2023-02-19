import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import PDFBlockComponent from "./PDFBlockComponent";

export default Node.create({
  name: "blockPDF",
  group: "block",

  atom: true,

  addAttributes() {
    return {
      fileObject: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "block-pdf",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["block-pdf", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PDFBlockComponent);
  },
});
