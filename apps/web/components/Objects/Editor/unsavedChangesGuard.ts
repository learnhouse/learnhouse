export function getEditorContentSnapshot(content: unknown): string {
  return JSON.stringify(content ?? null);
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
