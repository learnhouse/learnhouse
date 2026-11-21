/**
 * A dynamic-page document that uses every learner-facing block type the
 * editor ships, so the player is exercised against all of them at once.
 * Node names + attrs mirror apps/web/components/Objects/Editor/Extensions.
 */
const text = (t: string) => ({ type: 'text', text: t })
const p = (t: string) => ({ type: 'paragraph', content: [text(t)] })

export const QUIZ_QUESTION = 'Which planet is closest to the sun?'
export const QUIZ_RIGHT = 'Mercury'
export const QUIZ_WRONG = 'Neptune'
export const FLIP_QUESTION = 'What does HTTP stand for?'
export const FLIP_ANSWER = 'HyperText Transfer Protocol'

export function everyBlockDoc(): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('Every block')] },
      p('A plain paragraph with enough words to wrap on a phone screen and check line length.'),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          text(' '),
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          text(' '),
          { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://www.learnhouse.app' } }] },
          text(' '),
          { type: 'text', text: 'inline code', marks: [{ type: 'code' }] },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [text('Lists')] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p('First bullet')] },
          { type: 'listItem', content: [p('Second bullet')] },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          { type: 'listItem', content: [p('Step one')] },
          { type: 'listItem', content: [p('Step two')] },
        ],
      },
      { type: 'blockquote', content: [p('A quote worth remembering.')] },
      { type: 'horizontalRule' },
      {
        type: 'codeBlock',
        attrs: { language: 'python' },
        content: [text('def hello():\n    return "world"')],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [p('Term')] },
              { type: 'tableHeader', content: [p('Meaning')] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [p('LMS')] },
              { type: 'tableCell', content: [p('Learning management system')] },
            ],
          },
        ],
      },
      { type: 'calloutInfo', content: [text('An info callout.')] },
      { type: 'calloutWarning', content: [text('A warning callout.')] },
      { type: 'callout', attrs: { type: 'success', dismissible: false }, content: [p('A success callout.')] },
      { type: 'badge', attrs: { color: 'sky', emoji: '💡' }, content: [text('A badge')] },
      {
        type: 'button',
        attrs: { emoji: '🔗', link: 'https://www.learnhouse.app', color: 'blue', alignment: 'left' },
        content: [text('A button')],
      },
      {
        type: 'flipcard',
        attrs: { question: FLIP_QUESTION, answer: FLIP_ANSWER, color: 'blue', alignment: 'center', size: 'medium', style: 'solid' },
      },
      { type: 'blockMathEquation', attrs: { math_equation: 'E = mc^2' } },
      {
        type: 'blockQuiz',
        attrs: {
          quizId: 'quiz_e2e_1',
          questions: [
            {
              question_id: 'q1',
              question: QUIZ_QUESTION,
              type: 'multiple_choice',
              explanation: 'Mercury orbits closest.',
              answers: [
                { answer_id: 'a1', answer: QUIZ_RIGHT, correct: true },
                { answer_id: 'a2', answer: QUIZ_WRONG, correct: false },
              ],
            },
          ],
          settings: { shuffleAnswers: false, shuffleQuestions: false, maxAttempts: 0, showCorrectAnswers: true },
        },
      },
      {
        type: 'blockEmbed',
        attrs: {
          embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          embedCode: null,
          embedType: 'url',
          embedHeight: 300,
          embedWidth: '100%',
          alignment: 'left',
        },
      },
      {
        type: 'blockWebPreview',
        attrs: {
          url: 'https://www.learnhouse.app',
          title: 'LearnHouse',
          description: 'Open source LMS',
          og_image: null,
          favicon: null,
          alignment: 'left',
          showButton: true,
          buttonLabel: 'Visit',
          layout: 'card',
        },
      },
      p('The end.'),
    ],
  }
}

/** A short page used for progress/resume tests. */
export function shortDoc(title: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [text(title)] }, p(`Body of ${title}.`)] }
}
