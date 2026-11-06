'use client'

import React, { useMemo } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { ReactNodeViewContentProvider } from '@tiptap/react'
import { getExtensionField, resolveExtensions } from '@tiptap/core'
import type { AnyExtension, Extensions } from '@tiptap/core'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import { getNodeViewComponent } from '@components/Objects/Editor/core/nodeView'
import { lowlight } from '@components/Objects/Editor/editorLowlight'
import {
  getActivityExtensions,
  normalizeActivityContent,
} from '@components/Objects/Activities/DynamicCanva/activityExtensions'

/** Props handed to a `components` override. `Default` renders the built-in block. */
export interface StaticNodeProps {
  node: PMNode
  attrs: Record<string, any>
  parent?: PMNode
  children?: ReactNode
  Default: ComponentType<Omit<StaticNodeProps, 'Default'>>
}

/** Props handed to a `marks` override; it replaces the mark's markup entirely. */
export interface StaticMarkProps {
  mark: Mark
  attrs: Record<string, any>
  children?: ReactNode
}

export interface StaticCanvaProps {
  content: any
  activity: any
  courseUuid?: string
  orgUuid?: string
  /** Replace or wrap the rendering of a node type, keyed by node name (e.g. `blockQuiz`, `heading`). */
  components?: Record<string, ComponentType<StaticNodeProps>>
  /** Replace or wrap the rendering of a mark type, keyed by mark name (e.g. `link`, `bold`). */
  marks?: Record<string, ComponentType<StaticMarkProps>>
  /** Node types to leave out of the output entirely. */
  hiddenNodes?: string[]
  className?: string
}

const noop = () => {}

// Node views read a handful of editor fields. In static mode nothing is
// editable and there is no document position, so commands are inert and
// `state.doc.resolve()` only answers the one question blocks ask of it: the
// parent node (Flipcard uses it to know it sits in a grid).
function makeStaticEditor(node: PMNode, parent?: PMNode): any {
  const inert: any = new Proxy(noop, {
    get: (_target, key) => (key === 'run' ? () => false : inert),
    apply: () => inert,
  })
  return {
    isEditable: false,
    isDestroyed: false,
    storage: {},
    on: noop,
    off: noop,
    commands: inert,
    chain: () => inert,
    can: () => inert,
    view: { dom: null, dispatch: noop },
    state: {
      doc: {
        resolve: () => ({ parent }),
        nodeAt: () => node,
        descendants: noop,
      },
    },
  }
}

function nodeViewMapping(extensions: AnyExtension[]) {
  const mapping: Record<string, ComponentType<any>> = {}
  for (const extension of extensions) {
    if (extension.type !== 'node') continue
    const addNodeView = getExtensionField<() => unknown>(extension, 'addNodeView', {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
      editor: undefined,
      type: undefined,
    } as any)
    const component = addNodeView ? getNodeViewComponent(addNodeView()) : null
    if (!component) continue
    const inline = Boolean(getExtensionField(extension, 'inline', { name: extension.name, options: extension.options } as any))
    const name = extension.name
    mapping[name] = function StaticNodeView({ node, parent, children }: { node: PMNode; parent?: PMNode; children?: ReactNode }) {
      const Tag = inline ? 'span' : 'div'
      return (
        <Tag className={`react-renderer node-${name}`}>
          <ReactNodeViewContentProvider content={children}>
            {React.createElement(component, {
              node,
              extension,
              editor: makeStaticEditor(node, parent),
              getPos: () => 0,
              selected: false,
              decorations: [],
              innerDecorations: undefined,
              view: undefined,
              HTMLAttributes: {},
              updateAttributes: noop,
              deleteNode: noop,
            })}
          </ReactNodeViewContentProvider>
        </Tag>
      )
    }
  }
  return mapping
}

type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: Hast[] }

function hastToReact(node: Hast, key: number): ReactNode {
  if (node.type === 'text') return node.value
  const children = (node.children ?? []).map(hastToReact)
  if (node.type === 'element') {
    return React.createElement(node.tagName ?? 'span', { key, className: node.properties?.className?.join(' ') }, children)
  }
  return children
}

// The editor highlights code through a ProseMirror decoration plugin, which a
// static render never runs, so highlight here with the same lowlight instance.
function StaticCodeBlock({ node }: { node: PMNode }) {
  const language: string | null = node.attrs.language
  const code = node.textContent
  const tree = useMemo(() => {
    try {
      return language && lowlight.registered(language)
        ? lowlight.highlight(language, code)
        : lowlight.highlightAuto(code)
    } catch {
      return null
    }
  }, [language, code])
  return (
    <pre>
      <code className={language ? `language-${language}` : undefined}>
        {tree ? hastToReact(tree as Hast, 0) : code}
      </code>
    </pre>
  )
}

/**
 * Renders an activity document with the same extensions and block components
 * as DynamicCanva, without creating an editor. No ProseMirror view is built,
 * blocks are drawn on the first render, and a block's code is only loaded
 * when the document contains it.
 */
export default function StaticCanva(props: StaticCanvaProps) {
  const { components, marks, hiddenNodes } = props
  const content = useMemo(() => normalizeActivityContent(props.content), [props.content])

  const extensions: Extensions = useMemo(
    () => getActivityExtensions({ activity: props.activity, courseUuid: props.courseUuid, orgUuid: props.orgUuid }),
    [props.activity, props.courseUuid, props.orgUuid],
  )
  const defaults = useMemo(() => {
    const mapping = nodeViewMapping(resolveExtensions(extensions))
    mapping.codeBlock = StaticCodeBlock
    return mapping
  }, [extensions])

  const element = useMemo(() => {
    if (!content || typeof content !== 'object') return null

    const nodeMapping: Record<string, (_ctx: any) => ReactNode> = {}
    for (const [name, Component] of Object.entries(defaults)) {
      nodeMapping[name] = (ctx) => <Component {...ctx} />
    }
    for (const name of hiddenNodes ?? []) {
      nodeMapping[name] = () => null
    }
    for (const [name, Override] of Object.entries(components ?? {})) {
      const Builtin = defaults[name]
      nodeMapping[name] = (ctx) => {
        // Nodes without a block component render from their schema; re-render
        // just this node with the override taken out so `Default` is the stock output.
        const Default = Builtin
          ? (p: any) => <Builtin {...p} />
          : () => {
              const { [name]: _self, ...rest } = nodeMapping
              return renderToReactElement({ content: ctx.node.toJSON(), extensions, options: { nodeMapping: rest } })
            }
        return <Override node={ctx.node} attrs={ctx.node.attrs} parent={ctx.parent} Default={Default}>{ctx.children}</Override>
      }
    }

    const markMapping: Record<string, (_ctx: any) => ReactNode> = {}
    for (const [name, Override] of Object.entries(marks ?? {})) {
      markMapping[name] = (ctx) => (
        <Override mark={ctx.mark} attrs={ctx.mark.attrs}>{ctx.children}</Override>
      )
    }

    try {
      return renderToReactElement({
        content,
        extensions,
        options: {
          nodeMapping,
          markMapping,
          // Content from a newer server can carry blocks this build doesn't
          // know; keep their text instead of failing the whole activity.
          unhandledNode: ({ children }: any) => <div>{children}</div>,
          unhandledMark: ({ children }: any) => <>{children}</>,
        },
      })
    } catch (error) {
      console.error('[StaticCanva] could not render activity content', error)
      return null
    }
  }, [content, extensions, defaults, components, marks, hiddenNodes])

  return (
    <EditorOptionsProvider options={{ isEditable: false }}>
      <div className={`w-full mx-auto ${props.className ?? ''}`}>
        <div className="canva-content-wrapper">
          <div className="ProseMirror lh-static-canva" translate="no">
            {element}
          </div>
        </div>
      </div>
    </EditorOptionsProvider>
  )
}
