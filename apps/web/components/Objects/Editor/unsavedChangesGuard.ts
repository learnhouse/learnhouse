// H5P frames report their own height to us over postMessage, so `blockH5P`
// nodes can gain a new `height` attribute on first load without the author
// touching anything. Ignore it when deciding whether the document is dirty —
// otherwise opening an activity is enough to trigger the leave-confirm. The
// value still rides along on the next real save.
//
// That only holds while the block is on `auto`. Under any other `sizeMode` the
// height is the author's own choice, and dragging the frame's bottom edge on a
// block already set to `custom` moves nothing else — so stripping it there
// would let a real edit be thrown away with no leave-confirm at all.
//
// The rule is a function of the node's attributes rather than a flat key list
// precisely because that distinction lives in a sibling attribute.
const VOLATILE_ATTRS: Record<
  string,
  (_attrs: Record<string, unknown>) => readonly string[]
> = {
  blockH5P: (attrs) =>
    !attrs.sizeMode || attrs.sizeMode === "auto" ? ["height"] : [],
};

export function getEditorContentSnapshot(content: unknown): string {
  // A replacer keeps this to the single walk JSON.stringify already does; the
  // editor calls it on every keystroke, so a parallel copy of the document
  // would be a real cost. `this` is the object the key belongs to, which is
  // how an `attrs` value finds out which node type it hangs off.
  return JSON.stringify(content ?? null, function (this: any, key, value) {
    if (key !== "attrs" || !value || typeof value !== "object") return value;
    // Own-property only: node types come from stored content, and a node typed
    // "__proto__" would otherwise resolve to Object.prototype.
    const type = this?.type;
    const rule =
      typeof type === "string" && Object.hasOwn(VOLATILE_ATTRS, type)
        ? VOLATILE_ATTRS[type]
        : undefined;
    if (!rule) return value;
    const volatile = rule(value as Record<string, unknown>);
    if (!volatile.length) return value;
    const kept: Record<string, unknown> = {};
    for (const [attrKey, attrValue] of Object.entries(value)) {
      if (!volatile.includes(attrKey)) kept[attrKey] = attrValue;
    }
    return kept;
  });
}

export function hasEditorContentChanged(
  savedSnapshot: string,
  currentContent: unknown
): boolean {
  return getEditorContentSnapshot(currentContent) !== savedSnapshot;
}

export function createBeforeUnloadHandler(
  hasUnsavedChanges: () => boolean
) {
  return (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges()) {
      return undefined;
    }

    event.preventDefault();
    event.returnValue = "";
    return "";
  };
}

// The native `beforeunload` handler above only covers full-page unloads
// (reload / tab close / external navigation). Next.js App Router client-side
// navigation (e.g. clicking an in-app <Link>) never triggers `beforeunload`,
// so unsaved edits could be lost silently when leaving the editor that way.
// `shouldGuardNavigationClick` is a pure predicate used to decide whether a
// given anchor click is an in-app, same-tab navigation that we must confirm
// before allowing.

export interface NavigationClickLike {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface NavigationAnchorLike {
  href: string;
  target: string;
  origin: string;
  hasDownload: boolean;
}

export function shouldGuardNavigationClick(
  event: NavigationClickLike,
  anchor: NavigationAnchorLike | null,
  currentOrigin: string
): boolean {
  if (!anchor) return false;
  // Another handler already cancelled this click.
  if (event.defaultPrevented) return false;
  // Only guard primary (left) clicks.
  if (event.button !== 0) return false;
  // Modifier clicks open in a new tab/window and don't unload the editor.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  // Downloads don't navigate away.
  if (anchor.hasDownload) return false;
  // `target="_blank"` (and any non-self target) opens a new browsing context.
  if (anchor.target && anchor.target !== "_self") return false;
  if (!anchor.href) return false;
  // External links leave the app entirely — `beforeunload` already covers those.
  if (anchor.origin !== currentOrigin) return false;
  return true;
}
