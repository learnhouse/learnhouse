import { ReactNodeViewRenderer } from "@tiptap/react";
import { mergeAttributes, Node } from "@tiptap/core";
import dynamic from "next/dynamic";

const FlipcardGridExtension = dynamic(() => import("./FlipcardGridExtension"), {
  ssr: false,
});

/**
 * Container that lays its flipcards out side by side.
 *
 * A flipcard is `group: 'block'`, so two of them can never share a row on their
 * own — the grid has to come from a parent node. Existing standalone flipcards
 * are untouched; they keep rendering as full-width rows.
 */
export default Node.create({
  name: "flipcardGrid",
  group: "block",
  content: "flipcard+",
  draggable: true,

  addAttributes() {
    return {
      columns: {
        default: 2,
        // Round-tripped through HTML so the layout survives serialization
        // (mirrors the Callout block's data-attribute mapping).
        parseHTML: (element) => {
          const raw = parseInt(element.getAttribute("data-columns") || "2", 10);
          return Number.isNaN(raw) ? 2 : Math.min(4, Math.max(1, raw));
        },
        renderHTML: (attributes) => ({ "data-columns": attributes.columns }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "flipcard-grid",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["flipcard-grid", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FlipcardGridExtension as any);
  },
});
