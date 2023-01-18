export const initialData = {
  lectures: {
    "lecture-1": { id: "lecture-1", content: "First lecture" },
    "lecture-2": { id: "lecture-2", content: "Second lecture" },
    "lecture-3": { id: "lecture-3", content: "Third lecture" },
    "lecture-4": { id: "lecture-4", content: "Fourth lecture" },
    "lecture-5": { id: "lecture-5", content: "Fifth lecture" },
  },
  chapters: {
    "chapter-1": { id: "chapter-1", name: "Chapter 1", lectureIds: ["lecture-1", "lecture-2", "lecture-3"] },
    "chapter-2": { id: "chapter-2", name: "Chapter 2", lectureIds: ["lecture-4"] },
    "chapter-3": { id: "chapter-3", name: "Chapter 3", lectureIds: ["lecture-5"] },
  },

  chapterOrder: ["chapter-1", "chapter-2", "chapter-3"],
};

export const initialData2 = {
};

