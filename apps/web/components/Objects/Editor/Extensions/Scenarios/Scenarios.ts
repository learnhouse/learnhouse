import { ReactNodeViewRenderer } from "@tiptap/react";
import { mergeAttributes, Node } from "@tiptap/core";
import ScenariosExtension from "./ScenariosExtension";

export default Node.create({
  name: "scenarios",
  group: "block",
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      title: {
        default: 'Interactive Scenario',
      },
      scenarios: {
        default: [
          {
            id: '1',
            text: 'Welcome to this interactive scenario. What would you like to do?',
            imageUrl: '',
            options: [
              { id: 'opt1', text: 'Continue exploring', nextScenarioId: '2' },
              { id: 'opt2', text: 'Learn more about the topic', nextScenarioId: '3' }
            ]
          },
          {
            id: '2',
            text: 'Great choice! You are now exploring further. What\'s your next step?',
            imageUrl: '',
            options: [
              { id: 'opt3', text: 'Go back to start', nextScenarioId: '1' },
              { id: 'opt4', text: 'Finish scenario', nextScenarioId: null }
            ]
          },
          {
            id: '3',
            text: 'Here\'s more information about the topic. This helps you understand better.',
            imageUrl: '',
            options: [
              { id: 'opt5', text: 'Go back to start', nextScenarioId: '1' },
              { id: 'opt6', text: 'Finish scenario', nextScenarioId: null }
            ]
          }
        ],
      },
      currentScenarioId: {
        default: '1',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "scenarios-block",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["scenarios-block", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScenariosExtension);
  },
});
