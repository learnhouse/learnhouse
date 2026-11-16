/*
 CodeMirror setup for the Code playground: theme, language modes (lazy), and
 locked regions (lines between `// --- locked ---` markers learners can't edit).
*/
import type React from 'react'

export const cmStyles: React.CSSProperties = {
  fontSize: '14px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
}
export const cmClassName = [
  '[&_.cm-editor]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!border-r-transparent',
  '[&_.cm-activeLineGutter]:!bg-[#24283b]',
  '[&_.cm-activeLine]:!bg-[#24283b]',
  '[&_.cm-editor]:!outline-none',
  '[&_.cm-focused]:!outline-none',
  '[&_.cm-scroller]:!overflow-auto',
  '[&_.cm-line]:!px-4',
].join(' ')

export async function getTheme() {
  const { tokyoNight } = await import('@uiw/codemirror-theme-tokyo-night')
  return tokyoNight
}

export async function getLanguageExtension(codemirrorLang: string) {
  switch (codemirrorLang) {
    case 'python': {
      const { python } = await import('@codemirror/lang-python')
      return python()
    }
    case 'javascript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript()
    }
    case 'java': {
      const { java } = await import('@codemirror/lang-java')
      return java()
    }
    case 'cpp': {
      const { cpp } = await import('@codemirror/lang-cpp')
      return cpp()
    }
    case 'rust': {
      const { rust } = await import('@codemirror/lang-rust')
      return rust()
    }
    case 'go': {
      const { go } = await import('@codemirror/lang-go')
      return go()
    }
    case 'php': {
      const { php } = await import('@codemirror/lang-php')
      return php()
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql')
      return sql()
    }
    case 'xml': {
      const { xml } = await import('@codemirror/lang-xml')
      return xml()
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return markdown()
    }
    case 'wast': {
      const { wast } = await import('@codemirror/lang-wast')
      return wast()
    }
    case 'sass': {
      const { sass } = await import('@codemirror/lang-sass')
      return sass()
    }
    case 'perl': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { perl } = await import('@codemirror/legacy-modes/mode/perl')
      return StreamLanguage.define(perl)
    }
    case 'r': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { r } = await import('@codemirror/legacy-modes/mode/r')
      return StreamLanguage.define(r)
    }
    case 'haskell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { haskell } = await import(
        '@codemirror/legacy-modes/mode/haskell'
      )
      return StreamLanguage.define(haskell)
    }
    case 'lua': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { lua } = await import('@codemirror/legacy-modes/mode/lua')
      return StreamLanguage.define(lua)
    }
    case 'clojure': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { clojure } = await import(
        '@codemirror/legacy-modes/mode/clojure'
      )
      return StreamLanguage.define(clojure)
    }
    case 'shell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { shell } = await import('@codemirror/legacy-modes/mode/shell')
      return StreamLanguage.define(shell)
    }
    case 'pascal': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { pascal } = await import(
        '@codemirror/legacy-modes/mode/pascal'
      )
      return StreamLanguage.define(pascal)
    }
    case 'fortran': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { fortran } = await import(
        '@codemirror/legacy-modes/mode/fortran'
      )
      return StreamLanguage.define(fortran)
    }
    case 'powershell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { powerShell } = await import(
        '@codemirror/legacy-modes/mode/powershell'
      )
      return StreamLanguage.define(powerShell)
    }
    default: {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript()
    }
  }
}

// ── Locked Regions (Feature 6) ────────────────────────────────────
export function parseLockedRegions(code: string): Set<number> {
  const lines = code.split('\n')
  const locked = new Set<number>()
  let inLocked = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '// --- locked ---') {
      inLocked = !inLocked
      locked.add(i)
      continue
    }
    if (inLocked) locked.add(i)
  }
  return locked
}

export async function getLockedRegionExtensions(code: string): Promise<any[]> {
  const cmView = await import('@codemirror/view')
  const cmState = await import('@codemirror/state')

  const lockedLines = parseLockedRegions(code)

  class LockGutterMarker extends cmView.GutterMarker {
    toDOM() {
      const el = document.createElement('span')
      el.textContent = '\u{1F512}'
      el.style.fontSize = '10px'
      el.style.opacity = '0.6'
      return el
    }
  }
  const lockMarker = new LockGutterMarker()

  const lockedField = cmState.StateField.define<Set<number>>({
    create() { return lockedLines },
    update(value: Set<number>) { return value },
  })

  const lockedDecorations = cmView.EditorView.decorations.compute([lockedField], (state: any) => {
    const locked: Set<number> = state.field(lockedField)
    const builder = new (cmState.RangeSetBuilder as any)()
    const lineDeco = cmView.Decoration.line({ class: 'cm-locked-line' })
    for (let i = 1; i <= state.doc.lines; i++) {
      if (locked.has(i - 1)) {
        const line = state.doc.line(i)
        builder.add(line.from, line.from, lineDeco)
      }
    }
    return builder.finish()
  })

  const lockedGutter = cmView.gutter({
    class: 'cm-locked-gutter',
    lineMarker(view: any, line: any) {
      const lineNo = view.state.doc.lineAt(line.from).number - 1
      const locked: Set<number> = view.state.field(lockedField)
      return locked.has(lineNo) ? lockMarker : null
    },
  })

  const changeFilter = cmState.EditorState.changeFilter.of((tr: any) => {
    if (!tr.docChanged) return true
    const locked: Set<number> = tr.startState.field(lockedField)
    const doc = tr.startState.doc
    let allow = true
    tr.changes.iterChangedRanges((fromA: number, toA: number) => {
      const startLine = doc.lineAt(fromA).number - 1
      const endLine = doc.lineAt(Math.min(toA, doc.length)).number - 1
      for (let i = startLine; i <= endLine; i++) {
        if (locked.has(i)) { allow = false; break }
      }
    })
    return allow
  })

  const lockedTheme = cmView.EditorView.theme({
    '.cm-locked-line': {
      backgroundColor: 'rgba(18, 46, 74, 0.4)',
    },
  })

  return [lockedField, lockedDecorations, lockedGutter, changeFilter, lockedTheme]
}

