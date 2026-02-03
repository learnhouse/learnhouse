import { Mark, mergeAttributes } from '@tiptap/core'

export interface AIStreamingMarkOptions {
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiStreaming: {
      /**
       * Set the AI streaming mark
       */
      setAIStreaming: () => ReturnType
      /**
       * Unset the AI streaming mark
       */
      unsetAIStreaming: () => ReturnType
      /**
       * Toggle the AI streaming mark
       */
      toggleAIStreaming: () => ReturnType
    }
  }
}

export const AIStreamingMark = Mark.create<AIStreamingMarkOptions>({
  name: 'aiStreaming',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span.ai-streaming-text',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'ai-streaming-text',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setAIStreaming:
        () =>
        ({ commands }) => {
          return commands.setMark(this.name)
        },
      unsetAIStreaming:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
      toggleAIStreaming:
        () =>
        ({ commands }) => {
          return commands.toggleMark(this.name)
        },
    }
  },
})

export default AIStreamingMark
