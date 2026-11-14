// A test plugin: a `scratch:{id}` room kind anyone may edit, two internal
// routes over its loaded documents and a shutdown hook.

import type { CollabPlugin, CollabPluginDeps } from '../../../src/plugins.ts'

export const calls = { shutdown: 0, stored: [] as string[], deps: null as CollabPluginDeps | null }

export default function register(deps: CollabPluginDeps): CollabPlugin {
  calls.deps = deps
  return {
    name: 'scratch-test',
    kinds: [
      {
        name: 'scratch',
        parse: (name) => name.match(/^scratch:([a-z0-9]{1,20})$/)?.[1] ?? null,
        async authorize(_id, _token, userId) {
          return { readOnly: false, user: { id: userId, name: `user${userId}` } }
        },
        fetchAccess: async () => ({ ok: true, status: 200, json: async () => ({ role: 'editor' }) }),
        seats: { editors: 5, viewers: 5, noun: 'Scratch' },
        presence: { sanitize() {} },
        fetch: async () => null,
        async store(id) {
          calls.stored.push(id)
        },
        tooLargeReason: 'Scratch is too large',
      },
    ],
    internalRoutes: [
      {
        method: 'GET',
        path: /^\/internal\/scratch\/([a-z0-9]+)\/state$/,
        handle({ match }, documents) {
          const state = documents.encodeState(`scratch:${match[1]}`)
          return state
            ? { status: 200, body: { bytes: state.byteLength } }
            : { status: 404, body: { error: 'Room not loaded' } }
        },
      },
      {
        method: 'POST',
        path: /^\/internal\/scratch\/([a-z0-9]+)\/update$/,
        async handle({ match, readBody }, documents) {
          const { update } = JSON.parse(await readBody())
          return {
            status: 200,
            body: { applied: documents.applyUpdate(`scratch:${match[1]}`, new Uint8Array(Buffer.from(update, 'base64')), 'api') },
          }
        },
      },
      {
        method: 'GET',
        path: /^\/internal\/scratch\/boom$/,
        handle() {
          throw new Error('boom')
        },
      },
    ],
    async shutdown() {
      calls.shutdown++
    },
  }
}
