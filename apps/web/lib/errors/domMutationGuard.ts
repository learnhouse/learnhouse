/**
 * Keep React alive when something outside it rewrites the DOM it owns.
 *
 * Browser translation (Chrome's built-in "Translate this page", Google
 * Translate, Edge) swaps React's text nodes for <font> wrappers. The next time
 * React removes or moves one of those nodes it finds the node gone, and
 * `removeChild` / `insertBefore` throw NotFoundError. That tears down the whole
 * route and shows the error screen to someone who only asked for a
 * translation. Grammar and password-manager extensions do the same.
 *
 * The fix is the one the React team points to (facebook/react#11538): when the
 * node is no longer where React thinks it is, skip the operation instead of
 * throwing. The DOM is already in the state React wanted, or close enough that
 * the next render repairs it.
 */
export function installDomMutationGuard(proto: any = typeof Node === 'function' ? Node.prototype : undefined) {
  if (!proto || proto.__lhDomGuard) return
  proto.__lhDomGuard = true

  const removeChild = proto.removeChild
  proto.removeChild = function (this: Node, child: Node) {
    if (child.parentNode !== this) return child
    return removeChild.call(this, child)
  }

  const insertBefore = proto.insertBefore
  proto.insertBefore = function (this: Node, newNode: Node, referenceNode: Node | null) {
    if (referenceNode && referenceNode.parentNode !== this) return newNode
    return insertBefore.call(this, newNode, referenceNode)
  }
}
