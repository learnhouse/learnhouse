// Tables (owner: tables builder). Until the extended table lands this keeps
// the stock TipTap table exactly as the editor configured it before.
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import type { PlusExtensionFactory, SlashCommandItem } from '../types'

export const tableExtensions: PlusExtensionFactory = ({ mode }) => [
  Table.configure({ resizable: mode !== 'preview' }),
  TableRow,
  TableHeader,
  TableCell,
]

export const tableSlashItems: SlashCommandItem[] = []
