/**
 * SCORM API shim for sandboxed package content.
 *
 * SCORM packages are untrusted, editor-uploaded HTML and JavaScript. They are
 * served with `Content-Security-Policy: sandbox` (no `allow-same-origin`), so
 * package code runs in an opaque origin and cannot reach the player's
 * `window.API`. The content proxy injects this shim into every HTML document of
 * a package instead. It defines `window.API` (SCORM 1.2) or
 * `window.API_1484_11` (SCORM 2004) with synchronous answers from a local CMI
 * cache, seeded server side (`window.__LH_SCORM_SEED__`, written by the API just
 * after `<head>`), and reports every write to the player over postMessage. The
 * player forwards those to its `ScormRuntimeAPI`, which keeps persistence and
 * progress exactly as before.
 *
 * Kept free of Next/React imports so the proxy route, the player and tests can
 * all use it.
 */

/** Must match the API's CONTENT_SECURITY_POLICY and the iframe's `sandbox`. */
export const SCORM_SANDBOX_TOKENS = [
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
] as const

export const SCORM_CONTENT_CSP = `sandbox ${SCORM_SANDBOX_TOKENS.join(' ')}`

export const SCORM_IFRAME_SANDBOX = SCORM_SANDBOX_TOKENS.join(' ')

export const SCORM_MESSAGE_SOURCE = 'lh-scorm'
export const SCORM_SYNC_SOURCE = 'lh-scorm-sync'

// Read-only data model elements (prefix match), shared with ScormRuntimeAPI so
// the shim's synchronous answer always matches what the runtime then accepts.
export const SCORM_12_READ_ONLY = [
  'cmi.core._children',
  'cmi.core.student_id',
  'cmi.core.student_name',
  'cmi.core.credit',
  'cmi.core.entry',
  'cmi.core.total_time',
  'cmi.core.lesson_mode',
  'cmi.launch_data',
  'cmi.comments_from_lms',
]

export const SCORM_2004_READ_ONLY = [
  'cmi._version',
  'cmi.completion_threshold',
  'cmi.credit',
  'cmi.entry',
  'cmi.launch_data',
  'cmi.learner_id',
  'cmi.learner_name',
  'cmi.max_time_allowed',
  'cmi.mode',
  'cmi.scaled_passing_score',
  'cmi.time_limit_action',
  'cmi.total_time',
]

export const SCORM_12_ERROR_STRINGS: Record<string, string> = {
  '0': 'No Error',
  '101': 'General Exception',
  '201': 'Invalid argument error',
  '202': 'Element cannot have children',
  '203': 'Element not an array - Cannot have count',
  '301': 'Not initialized',
  '401': 'Not implemented error',
  '402': 'Invalid set value, element is a keyword',
  '403': 'Element is read only',
  '404': 'Element is write only',
  '405': 'Incorrect Data Type',
}

export const SCORM_2004_ERROR_STRINGS: Record<string, string> = {
  '0': 'No Error',
  '101': 'General Exception',
  '102': 'General Initialization Failure',
  '103': 'Already Initialized',
  '104': 'Content Instance Terminated',
  '111': 'General Termination Failure',
  '112': 'Termination Before Initialization',
  '113': 'Termination After Termination',
  '122': 'Retrieve Data Before Initialization',
  '123': 'Retrieve Data After Termination',
  '132': 'Store Data Before Initialization',
  '133': 'Store Data After Termination',
  '142': 'Commit Before Initialization',
  '143': 'Commit After Termination',
  '201': 'General Argument Error',
  '301': 'General Get Failure',
  '351': 'General Set Failure',
  '391': 'General Commit Failure',
  '401': 'Undefined Data Model Element',
  '402': 'Unimplemented Data Model Element',
  '403': 'Data Model Element Value Not Initialized',
  '404': 'Data Model Element Is Read Only',
  '405': 'Data Model Element Is Write Only',
  '406': 'Data Model Element Type Mismatch',
  '407': 'Data Model Element Value Out Of Range',
  '408': 'Data Model Dependency Not Established',
}

/**
 * Layout CSS for the package's top document (previously injected by the player
 * through `contentDocument`, which a cross-origin frame no longer allows).
 */
export const SCORM_TOP_FRAME_CSS = `
html, body {
  margin: 0 !important; padding: 0 !important; border: none !important; outline: none !important;
  overflow: hidden !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
  background: #fff !important; height: 100% !important; width: 100% !important;
}
* { border: none !important; outline: none !important; box-sizing: border-box !important; }
#navDiv, .navDiv {
  position: fixed !important; top: 8px !important; right: 50px !important; left: auto !important; bottom: auto !important;
  background: transparent !important; padding: 0 !important; display: flex !important; flex-direction: row !important;
  justify-content: flex-end !important; align-items: center !important; gap: 8px !important; z-index: 9999 !important;
  border: none !important; box-shadow: none !important;
}
#navDiv input[type="button"], #navDiv button, input#butPrevious, input#butNext, #butPrevious, #butNext {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  font-size: 13px !important; font-weight: 500 !important; padding: 8px 16px !important; border: none !important;
  border-radius: 9999px !important; cursor: pointer !important; transition: all 0.15s ease !important;
  min-width: auto !important; display: inline-flex !important; align-items: center !important;
  justify-content: center !important; gap: 6px !important; box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
  text-indent: 0 !important; line-height: 1 !important;
}
input#butPrevious, #butPrevious { background: rgba(255,255,255,0.95) !important; color: #171717 !important; }
input#butPrevious::before, #butPrevious::before {
  content: '' !important; display: inline-block !important; width: 6px !important; height: 6px !important;
  border-left: 2px solid #171717 !important; border-bottom: 2px solid #171717 !important;
  transform: rotate(45deg) !important; flex-shrink: 0 !important;
}
input#butPrevious:hover:not(:disabled), #butPrevious:hover:not(:disabled) {
  background: #fff !important; box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
}
input#butNext, #butNext { background: rgba(23,23,23,0.95) !important; color: #fff !important; }
input#butNext::after, #butNext::after {
  content: '' !important; display: inline-block !important; width: 6px !important; height: 6px !important;
  border-right: 2px solid #fff !important; border-top: 2px solid #fff !important;
  transform: rotate(45deg) !important; flex-shrink: 0 !important;
}
input#butNext:hover:not(:disabled), #butNext:hover:not(:disabled) {
  background: #171717 !important; box-shadow: 0 4px 12px rgba(0,0,0,0.25) !important;
}
input[type="button"]:disabled, button:disabled { opacity: 0.35 !important; cursor: not-allowed !important; }
#butExit, input#butExit { display: none !important; }
#contentFrame {
  position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
  width: 100% !important; height: 100% !important; border: none !important; margin: 0 !important; padding: 0 !important;
}
::-webkit-scrollbar { display: none !important; }
html, body, * { -ms-overflow-style: none !important; scrollbar-width: none !important; }
`

/** CSS for documents nested inside the package (e.g. a `#contentFrame`). */
export const SCORM_NESTED_FRAME_CSS = `
html, html body, body {
  margin: 0 !important; padding: 0 !important; border: none !important; background: #fff !important;
  overflow-x: hidden !important; overflow-y: auto !important; width: 100% !important; box-sizing: border-box !important;
}
img { max-width: 100% !important; height: auto !important; border: none !important; }
::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`

/**
 * The shim itself, ES5 so it runs in whatever a package targets. `__CONFIG__`
 * is replaced with a JSON literal. Runs as `function (w) {...}(window)`.
 */
const SHIM_SOURCE = `(function (w) {
  if (!w || w.__lhScormShim) return;
  w.__lhScormShim = true;
  var C = __CONFIG__;
  var hasOwn = Object.prototype.hasOwnProperty;
  var parentWin = null;
  try { parentWin = w.parent && w.parent !== w ? w.parent : null; } catch (e) { parentWin = null; }
  var isTopPackage = false;
  try { isTopPackage = !!parentWin && parentWin === w.top; } catch (e) { isTopPackage = false; }

  var seed = w.__LH_SCORM_SEED__ || null;
  var version = seed && seed.version === 'SCORM_2004' ? 'SCORM_2004' : (seed ? 'SCORM_12' : null);
  var cache = {};
  var dirty = {};
  if (seed && seed.cmi) for (var k in seed.cmi) if (hasOwn.call(seed.cmi, k)) cache[k] = String(seed.cmi[k]);
  var terminated = false;
  var lastError = '0';

  function post(msg) {
    if (!parentWin) return;
    try { parentWin.postMessage(msg, '*'); } catch (e) {}
  }
  function isChildFrame(src) {
    try { for (var i = 0; i < w.frames.length; i++) if (w.frames[i] === src) return true; } catch (e) {}
    return false;
  }
  function toChildren(msg) {
    try { for (var i = 0; i < w.frames.length; i++) w.frames[i].postMessage(msg, '*'); } catch (e) {}
  }
  function isReadOnly(v, el) {
    var list = v === 'SCORM_2004' ? C.ro2004 : C.ro12;
    for (var i = 0; i < list.length; i++) if (el.indexOf(list[i]) === 0) return true;
    return false;
  }
  function err(v, code12, code2004) { lastError = v === 'SCORM_2004' ? code2004 : code12; }

  function core(v) {
    return {
      init: function () { lastError = '0'; return 'true'; },
      finish: function () {
        if (terminated) { err(v, '101', '113'); return 'false'; }
        terminated = true; lastError = '0';
        post({ source: C.source, method: 'terminate', args: [] });
        return 'true';
      },
      get: function (el) {
        if (terminated) { err(v, '101', '123'); return ''; }
        lastError = '0';
        el = String(el);
        return hasOwn.call(cache, el) ? cache[el] : '';
      },
      set: function (el, value) {
        if (terminated) { err(v, '101', '133'); return 'false'; }
        el = String(el);
        if (isReadOnly(v, el)) { err(v, '403', '404'); return 'false'; }
        value = value === undefined || value === null ? '' : String(value);
        cache[el] = value; dirty[el] = true; lastError = '0';
        post({ source: C.source, method: 'setValue', args: [el, value] });
        return 'true';
      },
      commit: function () {
        if (terminated) { err(v, '101', '143'); return 'false'; }
        lastError = '0';
        post({ source: C.source, method: 'commit', args: [] });
        return 'true';
      },
      lastError: function () { return lastError; },
      errorString: function (code) {
        var s = v === 'SCORM_2004' ? C.err2004 : C.err12;
        return hasOwn.call(s, String(code)) ? s[String(code)] : 'Unknown Error';
      }
    };
  }

  if (version !== 'SCORM_2004') {
    var a = core('SCORM_12');
    w.API = {
      LMSInitialize: a.init, LMSFinish: a.finish, LMSGetValue: a.get, LMSSetValue: a.set,
      LMSCommit: a.commit, LMSGetLastError: a.lastError, LMSGetErrorString: a.errorString,
      LMSGetDiagnostic: a.errorString
    };
  }
  if (version !== 'SCORM_12') {
    var b = core('SCORM_2004');
    w.API_1484_11 = {
      Initialize: b.init, Terminate: b.finish, GetValue: b.get, SetValue: b.set,
      Commit: b.commit, GetLastError: b.lastError, GetErrorString: b.errorString,
      GetDiagnostic: b.errorString
    };
  }

  // The player answers 'hello' with its live CMI, which covers writes made by
  // an earlier page of the package that were not yet committed when this
  // document's seed was rendered. Keys this document already wrote win.
  function onMessage(e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    if (d.source === C.syncSource && parentWin && e.source === parentWin) {
      var cmi = d.cmi || {};
      for (var key in cmi) if (hasOwn.call(cmi, key) && !dirty[key]) cache[key] = String(cmi[key]);
      toChildren(d);
    } else if (d.source === C.source && e.source !== parentWin && isChildFrame(e.source)) {
      if (d.method === 'setValue' && d.args && d.args.length === 2) {
        cache[String(d.args[0])] = String(d.args[1]); dirty[String(d.args[0])] = true;
      }
      // Relay up; the player's answer to a relayed 'hello' comes back down
      // through toChildren() above.
      post(d);
    }
  }
  if (w.addEventListener) w.addEventListener('message', onMessage, false);
  post({ source: C.source, method: 'hello', args: [] });

  // Opaque-origin documents throw on storage and cookie access; many authoring
  // tools touch them unguarded. Give them an in-memory stand-in instead.
  function memoryStorage() {
    var data = {};
    var s = {
      getItem: function (key) { key = String(key); return hasOwn.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { data[String(key)] = String(value); },
      removeItem: function (key) { delete data[String(key)]; },
      clear: function () { data = {}; },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; }
    };
    try { Object.defineProperty(s, 'length', { get: function () { return Object.keys(data).length; } }); } catch (e) {}
    return s;
  }
  var names = ['localStorage', 'sessionStorage'];
  for (var n = 0; n < names.length; n++) {
    try { var probe = w[names[n]]; if (probe) probe.getItem('__lh'); } catch (e) {
      try { Object.defineProperty(w, names[n], { configurable: true, value: memoryStorage() }); } catch (e2) {}
    }
  }
  try { var c0 = w.document.cookie; } catch (e) {
    try {
      var jar = {};
      Object.defineProperty(w.document, 'cookie', {
        configurable: true,
        get: function () { var out = []; for (var j in jar) if (hasOwn.call(jar, j)) out.push(j + '=' + jar[j]); return out.join('; '); },
        set: function (v) {
          var pair = String(v).split(';')[0]; var at = pair.indexOf('=');
          if (at > 0) jar[pair.slice(0, at).replace(/^\\s+|\\s+$/g, '')] = pair.slice(at + 1);
        }
      });
    } catch (e2) {}
  }

  // Layout CSS, appended last in <head> so it wins the cascade.
  function addStyle() {
    try {
      var doc = w.document;
      var old = doc.getElementById('lh-scorm-styles');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var style = doc.createElement('style');
      style.id = 'lh-scorm-styles';
      style.appendChild(doc.createTextNode(isTopPackage || !parentWin ? C.css.top : C.css.nested));
      (doc.head || doc.documentElement).appendChild(style);
    } catch (e) {}
  }
  if (w.document && w.document.readyState !== 'loading') addStyle();
  else if (w.document && w.document.addEventListener) w.document.addEventListener('DOMContentLoaded', addStyle, false);
  if (w.addEventListener) w.addEventListener('load', addStyle, false);
})(window);`

/** JSON for embedding in an inline script: cannot close it or open a comment. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** The shim's JavaScript source (no `<script>` wrapper). */
export function buildScormShimSource(): string {
  const config = {
    source: SCORM_MESSAGE_SOURCE,
    syncSource: SCORM_SYNC_SOURCE,
    ro12: SCORM_12_READ_ONLY,
    ro2004: SCORM_2004_READ_ONLY,
    err12: SCORM_12_ERROR_STRINGS,
    err2004: SCORM_2004_ERROR_STRINGS,
    css: { top: SCORM_TOP_FRAME_CSS, nested: SCORM_NESTED_FRAME_CSS },
  }
  return SHIM_SOURCE.replace('__CONFIG__', () => scriptSafeJson(config))
}

let cachedShimTag: Uint8Array | null = null

/** The shim as an inline `<script>` element, UTF-8/ASCII bytes. */
export function scormShimScriptTag(): Uint8Array {
  if (!cachedShimTag) {
    const source = buildScormShimSource()
    // Pure ASCII, so it is valid in any ASCII-compatible charset the package uses.
    // eslint-disable-next-line no-control-regex
    const ascii = source.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
    cachedShimTag = new TextEncoder().encode(`<script data-lh-scorm-shim>${ascii}</script>`)
  }
  return cachedShimTag
}

// Byte-preserving view of the document for pattern search (index i of the
// string is byte i of the body), whatever charset the package uses.
function binaryString(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return out
}

const SEED_SCRIPT = /<script data-lh-scorm-seed>[^<]*<\/script>/i
const HEAD_OPEN = /<head(?:\s[^>]*)?>/i
const HTML_OPEN = /<html(?:\s[^>]*)?>/i
const DOCTYPE = /^\s*<!doctype[^>]*>/i

/** Where the shim goes: after the API's seed script (so the seed is already
 * defined when the shim runs), else after `<head>`, else after `<html>`, else
 * at the top past any BOM and doctype. -1 for UTF-16 documents. */
export function shimInsertionIndex(bytes: Uint8Array): number {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return -1
  }
  const text = binaryString(bytes)
  for (const pattern of [SEED_SCRIPT, HEAD_OPEN, HTML_OPEN]) {
    const match = pattern.exec(text)
    if (match) return match.index + match[0].length
  }
  let offset = text.startsWith('\xef\xbb\xbf') ? 3 : 0
  const doctype = DOCTYPE.exec(text.slice(offset))
  if (doctype) offset += doctype[0].length
  return offset
}

/** Insert the shim into an HTML document's bytes. */
export function injectScormShim(bytes: Uint8Array): Uint8Array {
  const at = shimInsertionIndex(bytes)
  if (at < 0) return bytes
  const tag = scormShimScriptTag()
  const out = new Uint8Array(bytes.length + tag.length)
  out.set(bytes.subarray(0, at), 0)
  out.set(tag, at)
  out.set(bytes.subarray(at), at + tag.length)
  return out
}

/** Claims of a launch token as the proxy needs them (not verified here; the API
 * verifies the signature on every request). */
export function readLaunchTokenHost(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof json?.h === 'string' ? json.h : null
  } catch {
    return null
  }
}

/** Lowercase hostname without port (same rule as the API's normalize_host). */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return ''
  let value = host.trim().toLowerCase()
  if (value.includes('://')) value = value.split('://')[1]
  value = value.split('/')[0]
  if (value.startsWith('[')) return value.split(']')[0] + ']'
  return value.split(':').length === 2 ? value.split(':')[0] : value
}

// ==================== Player side ====================

/** What the player needs from its runtime to serve the shim. */
export interface ScormShimRuntime {
  setValue(_element: string, _value: string): boolean
  requestCommit(): string
  requestTerminate(): string
  getCmiSnapshot(): Record<string, string>
}

/**
 * Apply one shim message to the player's runtime. The caller has already
 * checked `event.source === iframe.contentWindow`. Returns the sync message to
 * post back, if any. Only a fixed set of methods with string arguments is
 * honoured: the package is untrusted, but every method here is one it could
 * already call through the SCORM API.
 */
export function handleShimMessage(
  runtime: ScormShimRuntime | null,
  data: unknown
): { source: string; cmi: Record<string, string> } | null {
  if (!runtime || !data || typeof data !== 'object') return null
  const msg = data as { source?: unknown; method?: unknown; args?: unknown }
  if (msg.source !== SCORM_MESSAGE_SOURCE) return null
  const args = Array.isArray(msg.args) ? msg.args : []
  switch (msg.method) {
    case 'setValue':
      if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
        runtime.setValue(args[0], args[1])
      }
      return null
    case 'commit':
      runtime.requestCommit()
      return null
    case 'terminate':
      runtime.requestTerminate()
      return null
    case 'hello':
      return { source: SCORM_SYNC_SOURCE, cmi: runtime.getCmiSnapshot() }
    default:
      return null
  }
}
