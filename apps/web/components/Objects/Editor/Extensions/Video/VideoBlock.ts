import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import VideoBlockComponent from "./VideoBlockComponent";

export default Node.create({
  name: "blockVideo",
  group: "block",
  atom: true,
  
  addAttributes() {
    return {
      blockObject: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "block-video",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["block-video", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockComponent);
  },
});
