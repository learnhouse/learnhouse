/**
 * LearnHouse Apps SDK v1
 *
 * Tiny bridge client for third-party apps running inside the LearnHouse
 * dashboard's sandboxed iframe. Apps never hold credentials: every API call
 * is relayed to the host page via postMessage, and the host attaches a
 * short-lived token scoped to (admin-approved scopes ∩ current user rights).
 *
 * Usage:
 *   <script src="/apps-sdk/v1.js"></script>
 *   <script>
 *     lh.init().then((ctx) => {
 *       // ctx = { app, org, user, locale }
 *       return lh.api.get('courses/org_slug/' + ctx.org.slug + '/page/1/limit/10')
 *     })
 *   </script>
 */
(function () {
  'use strict'

  var BRIDGE_VERSION = 1
  var pending = {} // id -> {resolve, reject}
  var nextId = 1
  var initContext = null
  var initResolvers = []

  function post(message) {
    // targetOrigin '*' is required: this frame has an opaque origin and can
    // never name the host's origin. Only the embedding host page holds a
    // reference to this window, so delivery is inherently pinned.
    window.parent.postMessage(Object.assign({ lh: BRIDGE_VERSION }, message), '*')
  }

  window.addEventListener('message', function (event) {
    // Only the host (our parent) may talk to us.
    if (event.source !== window.parent) return
    var msg = event.data
    if (!msg || msg.lh !== BRIDGE_VERSION || typeof msg.type !== 'string') return

    if (msg.type === 'init') {
      initContext = msg.payload || {}
      for (var i = 0; i < initResolvers.length; i++) initResolvers[i](initContext)
      initResolvers = []
    } else if (msg.type === 'api:result' && msg.id != null && pending[msg.id]) {
      var entry = pending[msg.id]
      delete pending[msg.id]
      entry.resolve(msg.payload)
    }
  })

  function apiCall(method, path, body) {
    return new Promise(function (resolve, reject) {
      var id = nextId++
      pending[id] = { resolve: resolve, reject: reject }
      var payload = { method: method, path: path }
      if (body !== undefined) payload.body = body
      post({ id: id, type: 'api', payload: payload })
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id]
          reject(new Error('LearnHouse API call timed out'))
        }
      }, 30000)
    })
  }

  window.lh = {
    /** Handshake with the host. Resolves with { app, org, user, locale }. */
    init: function () {
      if (initContext) return Promise.resolve(initContext)
      return new Promise(function (resolve) {
        initResolvers.push(resolve)
        post({ type: 'ready' })
      })
    },
    /**
     * Call the LearnHouse API through the host bridge. `path` is relative to
     * /api/v1/ (e.g. 'courses/org_slug/acme/page/1/limit/10'). Resolves with
     * { ok, status, data }.
     */
    api: {
      get: function (path) { return apiCall('GET', path) },
      post: function (path, body) { return apiCall('POST', path, body) },
      put: function (path, body) { return apiCall('PUT', path, body) },
      patch: function (path, body) { return apiCall('PATCH', path, body) },
      del: function (path) { return apiCall('DELETE', path) },
    },
    /** Ask the host to grow the iframe to at least `height` CSS pixels. */
    resize: function (height) {
      post({ type: 'resize', payload: { height: height } })
    },
  }
})()
