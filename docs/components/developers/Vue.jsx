'use client'

import { AppWindow, Atom, Code } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from '../diagrams/FlowDiagram'

const neutralNode = { color: '#404040', bg: '#fafafa', border: '#ececec' }

/** How the Vue component reuses the React renderer instead of a copy of it. */
export function VueBridge() {
  return (
    <FlowDiagram
      nodes={[
        { label: '<LearnHouseActivity>', sub: 'Your Vue component: props, events, slots', icon: Code, ...neutralNode, edge: { label: 'properties' } },
        { label: '<learnhouse-activity>', sub: 'Custom element from @learnhouse/react', icon: AppWindow, ...neutralNode, edge: { label: 'React root' } },
        { label: 'LearnHouse blocks', sub: 'The same renderer the React package and the app use', icon: Atom, ...neutralNode },
      ]}
      caption="The Vue package has no blocks of its own. It passes your props to a custom element, which mounts the React renderer in its own root and sends its events back as DOM events."
    />
  )
}
