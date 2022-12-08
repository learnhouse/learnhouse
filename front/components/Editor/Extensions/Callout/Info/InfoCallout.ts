import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import InfoCalloutComponent from "./InfoCalloutComponent";

export default Node.create({
  name: "calloutInfo",
  group: "block",
  draggable: true,
  content: "inline*",

  parseHTML() {
    return [
      {
        tag: "callout-info",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["callout-info", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InfoCalloutComponent);
  },
});
