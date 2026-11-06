import CodeBlock from './components/CodeBlock/CodeBlock'
import { Table, Thead, Tbody, Tr, Th, Td } from './components/Table/Table'
import YouTube from './components/YouTube/YouTube'
import { Callout, Steps, Tabs } from './components/mdx'

// Elements and components every MDX page can use without importing them.
export function getMDXComponents(components) {
  return {
    pre: CodeBlock,
    table: Table,
    thead: Thead,
    tbody: Tbody,
    tr: Tr,
    th: Th,
    td: Td,
    YouTube,
    Callout,
    Steps,
    Tabs,
    ...components,
  }
}
