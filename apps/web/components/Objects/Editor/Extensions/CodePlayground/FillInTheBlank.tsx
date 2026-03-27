import { EditorView, Decoration, DecorationSet } from '@codemirror/view'
import { EditorState, StateField, RangeSetBuilder } from '@codemirror/state'

const BLANK_MARKER = '// --- blank ---'

export interface BlankRegion {
  fromLine: number
  toLine: number
}

export function parseBlankRegions(code: string): BlankRegion[] {
  const lines = code.split('\n')
  const regions: BlankRegion[] = []
  let start: number | null = null

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === BLANK_MARKER) {
      if (start === null) {
        start = i
      } else {
        regions.push({ fromLine: start + 1, toLine: i - 1 })
        start = null
      }
    }
  }
  return regions
}

export function getBlankRegionExtensions(code: string) {
  const blanks = parseBlankRegions(code)
  if (blanks.length === 0) return []

  const blankLineSet = new Set<number>()
  blanks.forEach((b) => {
    for (let i = b.fromLine; i <= b.toLine; i++) blankLineSet.add(i)
  })

  const blankField = StateField.define<Set<number>>({
    create: () => blankLineSet,
    update: (val) => val,
  })

  const blankDecoration = Decoration.line({ class: 'cm-blank-line' })
  const lockedDecoration = Decoration.line({ class: 'cm-fitb-locked' })

  const decorations = EditorView.decorations.compute([blankField], (state) => {
    const currentBlanks = state.field(blankField)
    const builder = new RangeSetBuilder<Decoration>()
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i)
      if (currentBlanks.has(i - 1)) {
        builder.add(line.from, line.from, blankDecoration)
      } else if (!line.text.trim().includes(BLANK_MARKER)) {
        builder.add(line.from, line.from, lockedDecoration)
      }
    }
    return builder.finish()
  })

  const changeFilter = EditorState.changeFilter.of((tr) => {
    const currentBlanks = tr.startState.field(blankField)
    let allow = true
    tr.changes.iterChangedRanges((fromA, toA) => {
      const lineFrom = tr.startState.doc.lineAt(fromA).number - 1
      const lineTo = tr.startState.doc.lineAt(toA).number - 1
      for (let l = lineFrom; l <= lineTo; l++) {
        if (!currentBlanks.has(l)) {
          allow = false
        }
      }
    })
    return allow
  })

  const theme = EditorView.baseTheme({
    '.cm-blank-line': {
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
      borderLeft: '2px solid rgba(59, 130, 246, 0.3)',
    },
    '.cm-fitb-locked': {
      opacity: '0.5',
    },
  })

  return [blankField, decorations, changeFilter, theme]
}
