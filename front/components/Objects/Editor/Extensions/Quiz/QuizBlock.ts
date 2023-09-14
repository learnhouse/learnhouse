import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import QuizBlockComponent from "./QuizBlockComponent";

export default Node.create({
  name: "blockQuiz",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      quizId: {
        value: null,
      },
      questions: {
        default: [],
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "block-quiz",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["block-quiz", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuizBlockComponent);
  },
});
