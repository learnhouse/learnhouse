import { Diagnostic } from '@codemirror/lint'
import { Text } from '@codemirror/state'

interface ParsedError {
  line: number // 1-indexed
  message: string
}

export function parseErrors(stderr: string | null, compileOutput: string | null): ParsedError[] {
  const errors: ParsedError[] = []
  const text = [stderr, compileOutput].filter(Boolean).join('\n')
  if (!text) return errors

  // Python: File "...", line N
  for (const m of text.matchAll(/File\s+"[^"]*",\s+line\s+(\d+)[^\n]*\n\s*(.+)/g)) {
    errors.push({ line: parseInt(m[1]), message: m[2].trim() })
  }

  // C/C++/Java/Rust: file:line:col: error: message
  for (const m of text.matchAll(/(?:^|\n)[^:\n]*?:(\d+):\d*:?\s*(?:error|warning):\s*(.+)/gi)) {
    errors.push({ line: parseInt(m[1]), message: m[2].trim() })
  }

  // Go: file.go:line:col: message
  for (const m of text.matchAll(/\.go:(\d+):\d+:\s*(.+)/g)) {
    errors.push({ line: parseInt(m[1]), message: m[2].trim() })
  }

  // JavaScript/Node: at Object.<anonymous> (file:line:col)
  if (errors.length === 0) {
    for (const m of text.matchAll(/(?:^|\n)\s*at\s+[^(]*\((?:[^:]*):(\d+):\d+\)/g)) {
      errors.push({ line: parseInt(m[1]), message: text.split('\n')[0].trim() })
      break
    }
  }

  // Generic fallback: "line N" or "Line N"
  if (errors.length === 0) {
    const genericMatch = text.match(/[Ll]ine\s+(\d+)/i)
    if (genericMatch) {
      errors.push({ line: parseInt(genericMatch[1]), message: text.split('\n')[0].trim() })
    }
  }

  return errors
}

export function errorsToDiagnostics(errors: ParsedError[], doc: Text): Diagnostic[] {
  return errors
    .filter((e) => e.line >= 1 && e.line <= doc.lines)
    .map((e) => {
      const line = doc.line(e.line)
      return {
        from: line.from,
        to: line.to,
        severity: 'error' as const,
        message: e.message,
      }
    })
}
