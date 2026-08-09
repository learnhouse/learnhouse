/**
 * Flags physical-direction Tailwind utilities in class strings, so the RTL
 * sweep doesn't quietly rot back to `ml-2` and `text-left`.
 *
 * Mirrors scripts/codemod-logical.mjs — if you change one, change both.
 * Paths that are LTR by design are excluded via `ignores` in eslint.config.mjs
 * rather than here, so the deny list lives in one place.
 */

/** Physical → logical. Longer prefixes first so rounded-tl- beats rounded-t. */
const PREFIX_MAP = [
  ['rounded-tl-', 'rounded-ss-'],
  ['rounded-tr-', 'rounded-se-'],
  ['rounded-br-', 'rounded-ee-'],
  ['rounded-bl-', 'rounded-es-'],
  ['rounded-l-', 'rounded-s-'],
  ['rounded-r-', 'rounded-e-'],
  ['scroll-ml-', 'scroll-ms-'],
  ['scroll-mr-', 'scroll-me-'],
  ['scroll-pl-', 'scroll-ps-'],
  ['scroll-pr-', 'scroll-pe-'],
  ['border-l-', 'border-s-'],
  ['border-r-', 'border-e-'],
  ['left-', 'start-'],
  ['right-', 'end-'],
  ['ml-', 'ms-'],
  ['mr-', 'me-'],
  ['pl-', 'ps-'],
  ['pr-', 'pe-'],
]

const EXACT_MAP = new Map([
  ['text-left', 'text-start'],
  ['text-right', 'text-end'],
  ['border-l', 'border-s'],
  ['border-r', 'border-e'],
  ['rounded-l', 'rounded-s'],
  ['rounded-r', 'rounded-e'],
  ['float-left', 'float-start'],
  ['float-right', 'float-end'],
])

/**
 * A 50% inset is a centering idiom, paired with a -50% translate that may live
 * in a sibling class, an inline style, or a stylesheet. Converting the inset
 * alone lands the element off-centre in RTL with no error anywhere, so the
 * codemod skips these and so does this rule.
 */
const CENTERING_INSET = /^-?(left|right)-(1\/2|\[50%\])$/

/**
 * Radix reports `data-side` as the RESOLVED physical side, so
 * `data-[side=left]:slide-in-from-right-2` is already direction-correct.
 * (`data-motion`, which is logical, is handled explicitly in navigation-menu.)
 */
const RADIX_PHYSICAL_SIDE = /data-\[side=/

const CLASS_ATTRS = new Set(['className', 'class', 'classNames', 'wrapperClassName'])
const CLASS_FNS = new Set(['cn', 'clsx', 'classNames', 'cva', 'twMerge', 'twJoin'])

/** Strip variant chains (`md:`, `hover:`, `data-[state=open]:`). */
function stripVariants(token) {
  let rest = token
  for (;;) {
    let depth = 0
    let cut = -1
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]
      if (c === '[') depth++
      else if (c === ']') depth--
      else if (c === ':' && depth === 0) {
        cut = i
        break
      }
    }
    if (cut === -1) return rest
    rest = rest.slice(cut + 1)
  }
}

function offendingToken(token) {
  const afterVariants = stripVariants(token)
  const bang = afterVariants.startsWith('!') ? '!' : ''
  let base = afterVariants.slice(bang.length)
  const neg = base.startsWith('-') ? '-' : ''
  base = base.slice(neg.length)

  if (CENTERING_INSET.test(neg + base)) return null

  const exact = EXACT_MAP.get(base)
  if (exact) return exact

  for (const [from, to] of PREFIX_MAP) {
    if (base.startsWith(from)) return to + base.slice(from.length)
  }
  return null
}

/**
 * Fallback for class lists extracted into a const, which appear in this
 * codebase (app/global-error.tsx, services/utils/ts/colorUtils.ts). Requires
 * EVERY token to look like a Tailwind class, so prose and URLs don't match.
 */
function looksLikeClassList(value) {
  const trimmed = value.trim()
  if (!trimmed || /[<>{}();=]/.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  if (tokens.length < 2) return false
  return tokens.every((t) => /^[!-]?[a-z0-9][a-z0-9._/:@[\]()#%,-]*$/.test(t))
}

function isClassContext(node) {
  let cur = node
  let hops = 0
  while (cur.parent && hops++ < 12) {
    const p = cur.parent
    if (p.type === 'JSXAttribute' && p.name && CLASS_ATTRS.has(p.name.name)) return true
    if (
      p.type === 'JSXExpressionContainer' ||
      p.type === 'ConditionalExpression' ||
      p.type === 'BinaryExpression' ||
      p.type === 'LogicalExpression' ||
      p.type === 'TemplateLiteral' ||
      p.type === 'ArrayExpression'
    ) {
      cur = p
      continue
    }
    if (p.type === 'Property') {
      const name = p.key?.name ?? p.key?.value ?? ''
      if (CLASS_ATTRS.has(name) || /class(Name)?$/i.test(String(name))) return true
      cur = p
      continue
    }
    if (p.type === 'ObjectExpression') {
      cur = p
      continue
    }
    if (p.type === 'CallExpression') {
      const callee = p.callee
      const name = callee?.name ?? callee?.property?.name ?? ''
      return CLASS_FNS.has(name)
    }
    return false
  }
  return false
}

export const noPhysicalDirection = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use logical Tailwind utilities (ms/me/ps/pe/start/end/text-start) so the UI mirrors under dir="rtl".',
    },
    schema: [],
    messages: {
      physical:
        '"{{token}}" is a physical-direction utility and will not mirror in RTL. Use "{{suggestion}}".',
    },
  },
  create(context) {
    function checkString(node, raw) {
      if (RADIX_PHYSICAL_SIDE.test(raw)) return
      if (!isClassContext(node) && !looksLikeClassList(raw)) return
      for (const token of raw.split(/\s+/)) {
        if (!token) continue
        const suggestion = offendingToken(token)
        if (suggestion) {
          context.report({ node, messageId: 'physical', data: { token, suggestion } })
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkString(node, node.value)
      },
      TemplateElement(node) {
        const raw = node.value?.cooked ?? node.value?.raw ?? ''
        if (raw) checkString(node, raw)
      },
    }
  },
}

export default {
  rules: { 'no-physical-direction': noPhysicalDirection },
}
