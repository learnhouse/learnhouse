'use client'

import { lazy, Suspense } from 'react'
import { NodeViewWrapper } from '@tiptap/react'

const BlockMath = lazy(async () => {
  await import('katex/dist/katex.min.css')
  const m = await import('react-katex')
  return { default: m.BlockMath }
})

export default function MathEquationBlockComponent(props: any) {
  const eq: string = props.node.attrs.math_equation ?? ''
  if (!eq) return null
  return (
    <NodeViewWrapper className="block-math-equation w-full">
      <div className="w-full overflow-x-auto py-2">
        <Suspense fallback={<code className="text-sm text-gray-500">{eq}</code>}>
          <BlockMath math={eq} />
        </Suspense>
      </div>
    </NodeViewWrapper>
  )
}
