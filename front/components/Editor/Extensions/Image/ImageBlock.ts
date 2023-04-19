import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import ImageBlockComponent from "./ImageBlockComponent";

export default Node.create({
  name: "blockImage",
  group: "block",

  atom: true,

  addAttributes() {
    return {
      blockObject: {
        default: null,
      },
      size: {
        width: 300,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "block-image",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["block-image", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockComponent);
  },
});
