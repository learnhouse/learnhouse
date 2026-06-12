import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs'
import Wrapper from './components/Wrapper/Wrapper'
import CodeBlock from './components/CodeBlock/CodeBlock'
import { Table, Thead, Tbody, Tr, Th, Td } from './components/Table/Table'

const docsComponents = getDocsMDXComponents()

export function useMDXComponents(components) {
  return {
    ...docsComponents,
    ...components,
    wrapper: Wrapper,
    pre: CodeBlock,
    table: Table,
    thead: Thead,
    tbody: Tbody,
    tr: Tr,
    th: Th,
    td: Td,
  }
}
