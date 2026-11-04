// A flipcard grid whose cards all hold short terms can stay two-up on a phone;
// anything longer would be cramped at half the screen width, so it stacks.
const COMPACT_MAX_CHARS = 48

export function isCompactFlipcardGrid(gridNode: any): boolean {
  if (!gridNode || gridNode.childCount === 0) return false
  let compact = true
  gridNode.forEach((card: any) => {
    const { question = '', answer = '' } = card.attrs || {}
    if (String(question).length > COMPACT_MAX_CHARS || String(answer).length > COMPACT_MAX_CHARS) {
      compact = false
    }
  })
  return compact
}
