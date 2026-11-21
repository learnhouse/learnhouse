/*
 The Experiences family, as the slash menu and the toolbar gallery list it.

 Each entry inserts its block filled in with a short, translated example, so
 an author sees a working exercise first and edits it rather than starting
 from an empty form. Scenarios and Flashcards are older nodes and keep their
 node names (`scenarios`, `flipcardGrid`) and slash ids.
*/
import React from 'react'
import type { TFunction } from 'i18next'
import {
  Cards,
  Crosshair,
  Gauge,
  GitBranch,
  Lightning,
  LinkSimple,
  ListNumbers,
  LockKey,
  MagnifyingGlass,
  Scales,
  Stack,
  Textbox,
} from '@phosphor-icons/react'
import type { BlockTone } from '../../Blocks/ui/BlockChrome'
import { newBlockId, newId } from './shared/utils'
import { NEW_EXPERIENCE_TYPES } from './experienceTypes'
import { defaultHotspotContent } from './Hotspot/hotspotModel'
import { exampleSort } from './Sort/sortModel'
import { exampleSequence } from './Sequence/sequenceModel'
import { exampleMatch } from './Match/matchModel'
import { defaultGapsContent } from './Gaps/gapsModel'
import { defaultSpotMistakeContent } from './SpotMistake/spotMistakeModel'

type T = TFunction | ((_key: string, _fallback?: any) => string)

export interface ExperienceEntry {
  id: string
  nodeName: string
  /** Slash command id (kept stable for the older blocks). */
  slashId: string
  titleKey: string
  descriptionKey: string
  /** English fallbacks (search, and before translations load). */
  title: string
  description: string
  icon: React.ComponentType<{ size?: number | string; weight?: any; className?: string }>
  tone: BlockTone
  keywords: string[]
  /** The node JSON inserted, with a fresh blockId. */
  defaultContent: (_t: T) => Record<string, any>
}

const k = (block: string, key: string) => `editor.experiences.${block}.example.${key}`

function tr(t: T, key: string, fallback: string): string {
  const out = (t as any)(key, fallback)
  return typeof out === 'string' && out && out !== key ? out : fallback
}

// Blocks that own their example content (their models export it, on the
// same editor.experiences.<block>.example.* keys).
const plainT = (t: T) => (key: string) => tr(t, key, key)
const fallbackT = (t: T) => (key: string, fallback: string) => tr(t, key, fallback)

function sortContent(t: T) {
  return { type: 'expSort', attrs: { blockId: newBlockId(), ...exampleSort(fallbackT(t)) } }
}

function sequenceContent(t: T) {
  return { type: 'expSequence', attrs: { blockId: newBlockId(), ...exampleSequence(fallbackT(t)) } }
}

function matchContent(t: T) {
  return { type: 'expMatch', attrs: { blockId: newBlockId(), ...exampleMatch(fallbackT(t)) } }
}

function hotspotContent(t: T) {
  return { type: 'expHotspot', attrs: { blockId: newBlockId(), ...defaultHotspotContent(plainT(t)) } }
}

function gapsContent(t: T) {
  return { type: 'expGaps', attrs: { blockId: newBlockId(), ...defaultGapsContent(plainT(t)) } }
}

function spotMistakeContent(t: T) {
  return { type: 'expSpotMistake', attrs: { blockId: newBlockId(), ...defaultSpotMistakeContent(plainT(t)) } }
}

function mythFactContent(t: T) {
  const s = (key: string, en: string, isTrue: boolean, why: string) => ({
    id: newId(),
    text: tr(t, k('myth_fact', key), en),
    isTrue,
    explanation: tr(t, k('myth_fact', `${key}_why`), why),
  })
  return {
    type: 'expMythFact',
    attrs: {
      blockId: newBlockId(),
      title: tr(t, k('myth_fact', 'title'), 'Myth or fact?'),
      statements: [
        s('goldfish', 'Goldfish only remember things for three seconds.', false, 'Goldfish can remember things for months.'),
        s('lightning', 'Lightning can strike the same place twice.', true, 'Tall buildings are struck many times a year.'),
        s('bats', 'Bats are blind.', false, 'Bats can see, and many also find their way by echolocation.'),
      ],
      labels: {
        true: tr(t, 'activities.experiences.common.fact', 'Fact'),
        false: tr(t, 'activities.experiences.common.myth', 'Myth'),
      },
    },
  }
}

function speedRoundContent(t: T) {
  const q = (prompt: string, options: string[], answer: number) => ({ id: newId(), prompt, options, answer })
  return {
    type: 'expSpeedRound',
    attrs: {
      blockId: newBlockId(),
      title: tr(t, k('speed_round', 'title'), 'Quick maths'),
      questions: [
        q('7 × 8', ['54', '56', '64'], 1),
        q('12 + 15', ['27', '25', '37'], 0),
        q('81 ÷ 9', ['7', '8', '9'], 2),
        q('15 − 6', ['9', '11', '8'], 0),
        q('6 × 6', ['32', '36', '42'], 1),
      ],
      secondsPerQuestion: 10,
      lives: 3,
    },
  }
}

function estimateContent(t: T) {
  return {
    type: 'expEstimate',
    attrs: {
      blockId: newBlockId(),
      question: tr(t, k('estimate', 'question'), 'How many bones are in an adult human body?'),
      min: 50,
      max: 400,
      step: 1,
      answer: 206,
      unit: tr(t, k('estimate', 'unit'), 'bones'),
      tolerancePct: 10,
      explanation: tr(
        t,
        k('estimate', 'explanation'),
        'An adult has 206 bones. Babies are born with about 300; some of them fuse together as we grow.',
      ),
    },
  }
}

function codeLockContent(t: T) {
  const clue = (key: string, en: string, answer: string, hintEn = '') => ({
    id: newId(),
    question: tr(t, k('code_lock', key), en),
    answer,
    ...(hintEn ? { hint: tr(t, k('code_lock', `${key}_hint`), hintEn) } : {}),
  })
  return {
    type: 'expCodeLock',
    attrs: {
      blockId: newBlockId(),
      title: tr(t, k('code_lock', 'title'), 'Escape the lab'),
      story: tr(t, k('code_lock', 'story'), 'The lab door is locked. Solve each clue to find the code.'),
      clues: [
        clue('c1', 'How many sides does a hexagon have?', '6', 'Think of a honeycomb cell.'),
        clue('c2', 'What is 3 squared?', '9'),
        clue('c3', 'How many continents are there?', '7', 'Africa is one of them.'),
      ],
      reward: tr(t, k('code_lock', 'reward'), 'The door swings open. Well done, detective!'),
    },
  }
}

function scenariosContent(t: T) {
  const s = (key: string, en: string) => tr(t, k('scenarios', key), en)
  return {
    type: 'scenarios',
    attrs: {
      title: s('title', 'A late order'),
      scenarios: [
        {
          id: '1',
          text: s('step1', 'A customer calls, upset that their order is a week late. What do you say first?'),
          imageUrl: '',
          options: [
            { id: 'opt1', text: s('step1_a', 'Apologise and ask for the order number'), nextScenarioId: '2' },
            { id: 'opt2', text: s('step1_b', 'Explain that delays happen'), nextScenarioId: '3' },
          ],
        },
        {
          id: '2',
          text: s('step2', 'You find the parcel stuck at the depot. What do you offer?'),
          imageUrl: '',
          options: [
            { id: 'opt3', text: s('step2_a', 'Free express delivery tomorrow'), nextScenarioId: null },
            { id: 'opt4', text: s('step2_b', 'Ask them to wait another week'), nextScenarioId: null },
          ],
        },
        {
          id: '3',
          text: s('step3', 'The customer gets more upset. What now?'),
          imageUrl: '',
          options: [
            { id: 'opt5', text: s('step3_a', 'Apologise and ask for the order number'), nextScenarioId: '2' },
            { id: 'opt6', text: s('step3_b', 'End the call'), nextScenarioId: null },
          ],
        },
      ],
      currentScenarioId: '1',
    },
  }
}

function flashcardsContent(t: T) {
  const card = (key: string, q: string, a: string) => ({
    type: 'flipcard',
    attrs: {
      question: tr(t, k('flashcards', `${key}_q`), q),
      answer: tr(t, k('flashcards', `${key}_a`), a),
      color: 'blue',
      alignment: 'center',
      size: 'medium',
    },
  })
  return {
    type: 'flipcardGrid',
    attrs: { columns: 2, title: tr(t, k('flashcards', 'title'), 'Cell biology') },
    content: [
      card('c1', 'Cell', 'The smallest living unit of every organism.'),
      card('c2', 'Nucleus', 'Holds the cell’s DNA and controls what it does.'),
      card('c3', 'Mitochondria', 'Turn food into energy the cell can use.'),
      card('c4', 'Membrane', 'Controls what goes in and out of the cell.'),
    ],
  }
}

const ICONS: Record<string, ExperienceEntry['icon']> = {
  scenarios: GitBranch,
  flashcards: Cards,
  sort: Stack,
  sequence: ListNumbers,
  match: LinkSimple,
  hotspot: Crosshair,
  gaps: Textbox,
  mythFact: Scales,
  speedRound: Lightning,
  estimate: Gauge,
  spotMistake: MagnifyingGlass,
  codeLock: LockKey,
}

const CONTENT: Record<string, (_t: T) => Record<string, any>> = {
  sort: sortContent,
  sequence: sequenceContent,
  match: matchContent,
  hotspot: hotspotContent,
  gaps: gapsContent,
  mythFact: mythFactContent,
  speedRound: speedRoundContent,
  estimate: estimateContent,
  spotMistake: spotMistakeContent,
  codeLock: codeLockContent,
}

const EN: Record<string, [string, string, string[]]> = {
  sort: ['Sort it', 'Group ideas into categories to see how they relate.', ['sort', 'categorise', 'categories', 'group', 'drag', 'classify']],
  sequence: ['Sequence', 'Put steps or events in order to build understanding.', ['sequence', 'order', 'steps', 'timeline', 'chronology']],
  match: ['Match pairs', 'Connect terms and meanings, or play a memory game.', ['match', 'pairs', 'memory', 'connect', 'matching']],
  hotspot: ['Hotspot', 'Find the right places on an image.', ['hotspot', 'image', 'diagram', 'click', 'label', 'map']],
  gaps: ['Fill the gaps', 'Recall the missing words in a passage.', ['gaps', 'fill', 'blanks', 'cloze', 'missing', 'words']],
  mythFact: ['Myth or fact', 'Sort true from false and learn why.', ['myth', 'fact', 'true', 'false', 'swipe', 'statements']],
  speedRound: ['Speed round', 'Quick-fire questions against the clock.', ['speed', 'timed', 'quiz', 'game', 'round', 'timer']],
  estimate: ['Estimate', 'Make a guess first, then see the real answer.', ['estimate', 'guess', 'predict', 'number', 'slider']],
  spotMistake: ['Spot the mistake', 'Find the errors in a text or a piece of code.', ['mistake', 'error', 'spot', 'proofread', 'bug', 'wrong']],
  codeLock: ['Code lock', 'Solve clues to open a lock, like an escape room.', ['code', 'lock', 'escape', 'puzzle', 'clues', 'riddle']],
}

export const experienceRegistry: ExperienceEntry[] = [
  {
    id: 'scenarios',
    nodeName: 'scenarios',
    slashId: 'scenarios',
    titleKey: 'editor.experiences.scenarios.title',
    descriptionKey: 'editor.experiences.scenarios.description',
    title: 'Scenarios',
    description: 'Practise decisions in a branching story.',
    icon: ICONS.scenarios,
    tone: 'interactive',
    keywords: ['scenarios', 'scenario', 'branching', 'interactive', 'choice', 'story', 'chat', 'roleplay'],
    defaultContent: scenariosContent,
  },
  {
    id: 'flashcards',
    nodeName: 'flipcardGrid',
    slashId: 'flipcardGrid',
    titleKey: 'editor.experiences.flashcards.title',
    descriptionKey: 'editor.experiences.flashcards.description',
    title: 'Flashcards',
    description: 'Flip cards to recall terms and study what you missed.',
    icon: ICONS.flashcards,
    tone: 'interactive',
    keywords: ['flipcard', 'flashcard', 'flashcards', 'cards', 'deck', 'grid', 'study', 'memory'],
    defaultContent: flashcardsContent,
  },
  ...NEW_EXPERIENCE_TYPES.map<ExperienceEntry>((x) => ({
    id: x.id,
    nodeName: x.nodeName,
    slashId: x.nodeName,
    titleKey: `editor.experiences.${x.i18n}.title`,
    descriptionKey: `editor.experiences.${x.i18n}.description`,
    title: EN[x.id][0],
    description: EN[x.id][1],
    icon: ICONS[x.id],
    tone: x.tone,
    keywords: EN[x.id][2],
    defaultContent: CONTENT[x.id],
  })),
]

export function experienceById(id: string): ExperienceEntry | undefined {
  return experienceRegistry.find((e) => e.id === id)
}

/**
 Insert an entry's example block at the editor's selection. When a whole
 block is selected (tiptap leaves the block it just inserted selected), the
 new one goes after it instead of replacing it, so picking a second
 experience from the gallery never wipes out the first.
*/
export function insertExperience(editor: { chain: () => any; state?: any }, entry: ExperienceEntry, t: T): boolean {
  const selection = editor.state?.selection
  const chain = editor.chain().focus()
  if (selection?.node) return chain.insertContentAt(selection.to, entry.defaultContent(t)).run()
  return chain.insertContent(entry.defaultContent(t)).run()
}
