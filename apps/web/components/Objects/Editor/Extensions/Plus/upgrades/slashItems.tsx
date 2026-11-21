/*
 Slash menu entries for the block upgrades: the button group (two buttons in
 the author's language) and an inline formula.
*/
import React from 'react'
import { CursorClick, Sigma } from '@phosphor-icons/react'
import i18n from '@/lib/i18n'
import type { SlashCommandItem } from '../types'
import { starterButtonGroup } from './upgradesModel'

const t = (key: string, fallback: string) => String(i18n.t(key, fallback))

export const upgradesSlashItems: SlashCommandItem[] = [
  {
    id: 'buttonGroup',
    title: 'Button group',
    description: 'Several buttons side by side',
    titleKey: 'editor.slash_menu.items.button_group.title',
    descriptionKey: 'editor.slash_menu.items.button_group.description',
    icon: <CursorClick size={17} />,
    category: 'ui',
    keywords: ['buttons', 'button group', 'actions', 'cta', 'links'],
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent(
          starterButtonGroup({
            primary: t('editor.blocks_v2.button_group.primary', 'Get started'),
            secondary: t('editor.blocks_v2.button_group.secondary', 'Learn more'),
          }),
        )
        .run()
    },
  },
  {
    id: 'inlineMath',
    title: 'Inline formula',
    description: 'A formula inside a sentence (or type $x^2$)',
    titleKey: 'editor.slash_menu.items.inline_math.title',
    descriptionKey: 'editor.slash_menu.items.inline_math.description',
    icon: <Sigma size={17} />,
    category: 'text',
    keywords: ['math', 'formula', 'latex', 'equation', 'inline', 'katex'],
    command: (editor) => {
      editor.chain().focus().insertInlineMath('x^2').run()
    },
  },
]
