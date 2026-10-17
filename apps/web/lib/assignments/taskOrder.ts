type OrderedTask = { id: number; order?: number | null }

// Tasks in the order the instructor set. Rows created before ordering
// existed have no `order` and fall back to creation (id) order, matching
// the API.
export function sortTasksByOrder<T extends OrderedTask>(tasks: T[] | null | undefined): T[] {
  if (!Array.isArray(tasks)) return []
  return tasks.slice().sort((a, b) => {
    const aOrder = a.order ?? Number.POSITIVE_INFINITY
    const bOrder = b.order ?? Number.POSITIVE_INFINITY
    if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1
    return a.id - b.id
  })
}

// Move one task and renumber `order` so the cached list matches what the
// API stores after the reorder call.
export function moveTask<T extends OrderedTask>(tasks: T[], from: number, to: number): T[] {
  const reordered = tasks.slice()
  const [moved] = reordered.splice(from, 1)
  if (moved === undefined) return tasks
  reordered.splice(to, 0, moved)
  return reordered.map((task, index) => ({ ...task, order: index }))
}
