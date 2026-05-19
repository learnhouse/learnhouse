// Maps Tiptap node-type names to their lazy-loaded React component file.
// When EditorWrapper sees a content document, it scans for these node types
// and kicks off non-awaited dynamic imports so the chunks land in cache before
// the editor mounts and tries to render them.
const COMPONENT_LOADERS: Record<string, () => Promise<unknown>> = {
  blockVideo: () => import('./Extensions/Video/VideoBlockComponent'),
  blockAudio: () => import('./Extensions/Audio/AudioBlockComponent'),
  blockImage: () => import('./Extensions/Image/ImageBlockComponent'),
  blockMathEquation: () =>
    import('./Extensions/MathEquation/MathEquationBlockComponent'),
  blockPDF: () => import('./Extensions/PDF/PDFBlockComponent'),
  blockQuiz: () => import('./Extensions/Quiz/QuizBlockComponent'),
  blockEmbed: () => import('./Extensions/EmbedObjects/EmbedObjectsComponent'),
  blockUser: () => import('./Extensions/Users/UserBlockComponent'),
  blockWebPreview: () => import('./Extensions/WebPreview/WebPreviewComponent'),
  blockMagic: () => import('./Extensions/MagicBlocks/MagicBlockComponent'),
  blockCode: () => import('./Extensions/CodePlayground/CodePlaygroundComponent'),
  scenarios: () => import('./Extensions/Scenarios/ScenariosExtension'),
  flipcard: () => import('./Extensions/Flipcard/FlipcardExtension'),
}

function collectNodeTypes(node: any, types: Set<string>): void {
  if (!node) return
  if (Array.isArray(node)) {
    for (const child of node) collectNodeTypes(child, types)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'string') types.add(node.type)
  if (node.content) collectNodeTypes(node.content, types)
}

export function preloadComponentsForContent(doc: any): void {
  if (!doc || typeof window === 'undefined') return
  const types = new Set<string>()
  collectNodeTypes(doc, types)
  for (const t of types) {
    const loader = COMPONENT_LOADERS[t]
    if (loader) {
      loader().catch(() => {
        // Swallow — the node-view's own dynamic() will retry on render.
      })
    }
  }
}
