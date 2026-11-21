/*
 Turns the chart's DOMOutputSpec-shaped tree (chartModel.chartSvg) into
 React elements, so the live chart and the server SVG come from one drawing.
*/
import React from 'react'
import type { SvgSpec } from '../chartModel'

const RENAME: Record<string, string> = {
  class: 'className',
  tabindex: 'tabIndex',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
  'stroke-width': 'strokeWidth',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-linecap': 'strokeLinecap',
  'fill-opacity': 'fillOpacity',
}

/** "fill:red;stroke-width:2" → { fill: 'red', strokeWidth: '2' } */
export function styleObject(style: string): React.CSSProperties {
  const out: Record<string, string> = {}
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i < 1) continue
    const prop = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim()
    if (!prop || !value) continue
    out[prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = value
  }
  return out as React.CSSProperties
}

export function specToReact(spec: SvgSpec | string, key?: React.Key): React.ReactNode {
  if (typeof spec === 'string') return spec
  const [tag, attrs, ...children] = spec
  const props: Record<string, unknown> = { key }
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'xmlns') continue
    if (name === 'style') props.style = styleObject(value)
    else props[RENAME[name] ?? name] = value
  }
  return React.createElement(tag, props, ...children.map((c, i) => specToReact(c, i)))
}
