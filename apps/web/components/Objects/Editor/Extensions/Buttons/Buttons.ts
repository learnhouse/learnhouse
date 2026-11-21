import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from "@tiptap/core";
import ButtonsExtension from "./ButtonsExtension";
import { BUTTON_EXTRA_ATTRS } from "../../Blocks/schema/blockAttrs";

export default Node.create({
  name: "button",
  group: "block",
  draggable: true,
  content: "text*",

  addAttributes() {
    return {
      emoji: {
        default: '🔗',
      },
      link: {
        default: '',
      },
      color: {
        default: 'blue',
      },
      alignment: {
        default: 'left',
      },
      // Editor Plus: style and size. null = solid / medium, the original button.
      ...BUTTON_EXTRA_ATTRS,
    };
  },

  parseHTML() {
    return [
      {
        tag: "button-block",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["button-block", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return lhNodeView(ButtonsExtension);
  },
});