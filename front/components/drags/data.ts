export const initialData = {
  elements: {
    "element-1": { id: "element-1", content: "First element" },
    "element-2": { id: "element-2", content: "Second element" },
    "element-3": { id: "element-3", content: "Third element" },
    "element-4": { id: "element-4", content: "Fourth element" },
    "element-5": { id: "element-5", content: "Fifth element" },
  },
  chapters: {
    "chapter-1": { id: "chapter-1", name: "Chapter 1", elementIds: ["element-1", "element-2", "element-3"] },
    "chapter-2": { id: "chapter-2", name: "Chapter 2", elementIds: ["element-4"] },
    "chapter-3": { id: "chapter-3", name: "Chapter 3", elementIds: ["element-5"] },
  },

  chapterOrder: ["chapter-1", "chapter-2", "chapter-3"],
};
