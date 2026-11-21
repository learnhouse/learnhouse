/*
 The Experiences nodes, configured once for every schema that must know
 them: the editor (Editor.tsx), the read-only canvas and its static twin
 (activityExtensions.ts, which also feeds @learnhouse/react), and the editor
 preview (EditorPreview.tsx). Adding a node here registers it everywhere, so
 no client ever drops a block another client wrote (see the collab notes in
 EXPERIENCES_SPEC.md).
*/
import type { AnyExtension } from '@tiptap/core'
import Sort from './Sort/Sort'
import Sequence from './Sequence/Sequence'
import Match from './Match/Match'
import Hotspot from './Hotspot/Hotspot'
import Gaps from './Gaps/Gaps'
import MythFact from './MythFact/MythFact'
import SpeedRound from './SpeedRound/SpeedRound'
import Estimate from './Estimate/Estimate'
import SpotMistake from './SpotMistake/SpotMistake'
import CodeLock from './CodeLock/CodeLock'
import Venn from './Venn/Venn'
import Label from './Label/Label'
import WordGuess from './WordGuess/WordGuess'
import Confidence from './Confidence/Confidence'
import Matrix from './Matrix/Matrix'
import Reflect from './Reflect/Reflect'

export const EXPERIENCE_EXTENSIONS = [Sort, Sequence, Match, Hotspot, Gaps, MythFact, SpeedRound, Estimate, SpotMistake, CodeLock, Venn, Label, WordGuess, Confidence, Matrix, Reflect] as const

export function experienceExtensions(options: { editable: boolean; activity: any }): AnyExtension[] {
  return EXPERIENCE_EXTENSIONS.map((ext) => (ext as any).configure({ editable: options.editable, activity: options.activity }) as AnyExtension)
}
