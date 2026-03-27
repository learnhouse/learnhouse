'use client'
import React from 'react'

interface Props {
  studentCode: string
  solutionCode: string
}

function diffLines(a: string, b: string): { type: 'same' | 'added' | 'removed'; text: string }[] {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = []

  let ai = 0
  let bi = 0

  while (ai < aLines.length || bi < bLines.length) {
    if (ai < aLines.length && bi < bLines.length && aLines[ai] === bLines[bi]) {
      result.push({ type: 'same', text: aLines[ai] })
      ai++
      bi++
    } else if (ai < aLines.length && (bi >= bLines.length || !bLines.includes(aLines[ai]))) {
      result.push({ type: 'removed', text: aLines[ai] })
      ai++
    } else if (bi < bLines.length) {
      result.push({ type: 'added', text: bLines[bi] })
      bi++
    }
  }

  return result
}

const bgMap = {
  same: '',
  added: 'bg-emerald-50 text-emerald-800',
  removed: 'bg-red-50 text-red-800 line-through opacity-60',
}
const prefixMap = { same: ' ', added: '+', removed: '-' }

export default function CodeDiff({ studentCode, solutionCode }: Props) {
  const lines = diffLines(studentCode, solutionCode)

  return (
    <div className="rounded-lg border border-neutral-200 overflow-hidden nice-shadow">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 border-b border-neutral-200">
        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Your Code vs Solution</span>
      </div>
      <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i} className={`px-3 py-0.5 ${bgMap[line.type]}`}>
            <span className="inline-block w-4 text-neutral-400 select-none">{prefixMap[line.type]}</span>
            {line.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
