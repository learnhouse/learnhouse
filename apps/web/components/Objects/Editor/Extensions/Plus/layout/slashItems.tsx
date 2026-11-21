/*
 Slash menu entries for the layout blocks. Starter content is written in the
 author's language and stays ordinary editable text.
*/
import React from 'react'
import { BookOpenText, CheckSquare, Columns, Key, Path, Rows, Tabs } from '@phosphor-icons/react'
import i18n from '@/lib/i18n'
import type { SlashCommandItem } from '../types'
import {
  starterAccordion,
  starterChecklist,
  starterColumns,
  starterKeyTakeaways,
  starterTableOfContents,
  starterTabs,
  starterTimeline,
} from './layoutModel'

const t = (key: string, fallback: string) => String(i18n.t(key, fallback))

const item = (
  id: string,
  keys: [titleKey: string, descriptionKey: string],
  title: string,
  description: string,
  icon: React.ReactNode,
  keywords: string[],
  build: () => any,
  category: SlashCommandItem['category'] = 'layout',
): SlashCommandItem => ({
  id,
  title,
  description,
  titleKey: keys[0],
  descriptionKey: keys[1],
  icon,
  category,
  keywords,
  command: (editor) => {
    editor.chain().focus().insertContent(build()).run()
  },
})

export const layoutSlashItems: SlashCommandItem[] = [
  item('tabs', ['editor.slash_menu.items.tabs.title', 'editor.slash_menu.items.tabs.description'], 'Tabs', 'Switch between panels of content', <Tabs size={17} />, ['tabs', 'tab', 'panels', 'switch'], () => starterTabs(t)),
  item('columns', ['editor.slash_menu.items.columns.title', 'editor.slash_menu.items.columns.description'], 'Columns', 'Place content side by side', <Columns size={17} />, ['columns', 'grid', 'side by side', 'layout', 'split'], () => starterColumns(t)),
  item('accordion', ['editor.slash_menu.items.accordion.title', 'editor.slash_menu.items.accordion.description'], 'Accordion', 'Collapsible sections, one open at a time', <Rows size={17} />, ['accordion', 'faq', 'collapse', 'toggle', 'sections'], () => starterAccordion(t)),
  item('timeline', ['editor.slash_menu.items.timeline.title', 'editor.slash_menu.items.timeline.description'], 'Timeline', 'Steps or events in order', <Path size={17} />, ['timeline', 'steps', 'process', 'roadmap', 'history'], () => starterTimeline(t)),
  item('tableOfContents', ['editor.slash_menu.items.table_of_contents.title', 'editor.slash_menu.items.table_of_contents.description'], 'Table of contents', 'Links to the headings of this page', <BookOpenText size={17} />, ['toc', 'table of contents', 'outline', 'contents', 'headings'], () => starterTableOfContents()),
  item('keyTakeaways', ['editor.slash_menu.items.key_takeaways.title', 'editor.slash_menu.items.key_takeaways.description'], 'Key takeaways', 'A summary card of the main points', <Key size={17} />, ['takeaways', 'summary', 'key points', 'recap', 'tl;dr'], () => starterKeyTakeaways(t)),
  item('checklist', ['editor.slash_menu.items.checklist.title', 'editor.slash_menu.items.checklist.description'], 'Checklist', 'Items learners can tick off', <CheckSquare size={17} />, ['checklist', 'todo', 'task', 'checkbox', 'list'], () => starterChecklist(t), 'text'),
]
