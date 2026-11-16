// Browser page translation (Chrome, the Google app on iOS, Edge...) swaps the
// text nodes React rendered for translated ones. When React later removes or
// inserts next to one of its own nodes, the node is no longer where React left
// it and the DOM call throws ("NotFoundError: The object can not be found
// here" / "Failed to execute 'removeChild' on 'Node'"), which takes the whole
// page down for anyone reading it translated.
//
// Tolerate exactly that case: a node that already moved is left alone instead
// of crashing the tree. See https://github.com/facebook/react/issues/11538.
;(function () {
  if (typeof Node !== 'function' || !Node.prototype) return
  var originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function (child) {
    if (child && child.parentNode !== this) return child
    return originalRemoveChild.apply(this, arguments)
  }
  var originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) return newNode
    return originalInsertBefore.apply(this, arguments)
  }
})()
