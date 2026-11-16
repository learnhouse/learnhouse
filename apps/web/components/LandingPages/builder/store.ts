'use client'
/**
 * Builder state: the document, selection, breakpoint and undo/redo history.
 * Every edit goes through `commit`, which records history; typing in a field
 * coalesces into one step (same `key` within COALESCE_MS).
 */
import React from 'react'
import type { Breakpoint, LandingDoc } from '../model/types'

const HISTORY_LIMIT = 100
const COALESCE_MS = 700

export interface BuilderState {
  doc: LandingDoc
  past: LandingDoc[]
  future: LandingDoc[]
  selectedId: string | null
  hoverId: string | null
  editingId: string | null
  breakpoint: Breakpoint
  /** Last coalescing key and when it was used. */
  lastKey: string | null
  lastAt: number
  /** Bumped on every document change, for autosave. */
  version: number
}

type Action =
  | { type: 'commit'; doc: LandingDoc; key?: string; select?: string | null }
  | { type: 'reset'; doc: LandingDoc; keepHistory?: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; id: string | null }
  | { type: 'hover'; id: string | null }
  | { type: 'edit'; id: string | null }
  | { type: 'breakpoint'; value: Breakpoint }

export function initialState(doc: LandingDoc): BuilderState {
  return { doc, past: [], future: [], selectedId: null, hoverId: null, editingId: null, breakpoint: 'base', lastKey: null, lastAt: 0, version: 0 }
}

export function reducer(state: BuilderState, action: Action): BuilderState {
  switch (action.type) {
    case 'commit': {
      if (action.doc === state.doc) return action.select !== undefined ? { ...state, selectedId: action.select } : state
      const now = Date.now()
      const coalesce = !!action.key && action.key === state.lastKey && now - state.lastAt < COALESCE_MS
      const past = coalesce ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT)
      return {
        ...state,
        doc: action.doc,
        past,
        future: [],
        lastKey: action.key || null,
        lastAt: now,
        version: state.version + 1,
        selectedId: action.select !== undefined ? action.select : state.selectedId,
      }
    }
    case 'reset':
      return {
        ...state,
        doc: action.doc,
        past: action.keepHistory ? [...state.past, state.doc].slice(-HISTORY_LIMIT) : [],
        future: [],
        lastKey: null,
        version: action.keepHistory ? state.version + 1 : state.version,
        editingId: null,
      }
    case 'undo': {
      const prev = state.past[state.past.length - 1]
      if (!prev) return state
      return { ...state, doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future], lastKey: null, version: state.version + 1, editingId: null }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return { ...state, doc: next, past: [...state.past, state.doc], future: state.future.slice(1), lastKey: null, version: state.version + 1, editingId: null }
    }
    case 'select':
      return { ...state, selectedId: action.id, editingId: action.id === state.editingId ? state.editingId : null }
    case 'hover':
      return action.id === state.hoverId ? state : { ...state, hoverId: action.id }
    case 'edit':
      return { ...state, editingId: action.id, selectedId: action.id ?? state.selectedId }
    case 'breakpoint':
      return { ...state, breakpoint: action.value }
    default:
      return state
  }
}

export function useBuilderStore(doc: LandingDoc) {
  return React.useReducer(reducer, doc, initialState)
}

export type BuilderDispatch = React.Dispatch<Action>
