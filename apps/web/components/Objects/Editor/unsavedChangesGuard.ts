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
