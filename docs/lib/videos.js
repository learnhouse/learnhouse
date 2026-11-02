// Video guides embedded in the docs with <YouTube video="..." />.
//
// A slot renders nothing until its `youtubeId` is set, so pages can reference
// a video before it is published. To turn one on, paste the ID from the
// YouTube URL (https://www.youtube.com/watch?v=<ID>) into `youtubeId`.
export const VIDEOS = {
  // LearnHouse Guides: how each feature works
  'guide-1': { title: 'How to create your first online course', youtubeId: null },
  'guide-2': { title: 'How to create assignments and grade them online', youtubeId: null },
  'guide-3': { title: 'How to teach a live class on an online whiteboard', youtubeId: null },
  'guide-4': { title: 'How learners take your online course, with AI help', youtubeId: null },
  'guide-5': { title: 'How to manage course access, members and SEO', youtubeId: null },
  'guide-6': { title: 'How to make interactive lessons with AI', youtubeId: null },
  'guide-7': { title: 'How to give course certificates', youtubeId: null },
  'guide-8': { title: 'How to build a community for your online course', youtubeId: null },
  'guide-9': { title: 'How to start a podcast for your learners', youtubeId: null },
  'guide-10': { title: 'How to brand your online academy', youtubeId: null },

  // Migrating from another LMS
  'migrate-1': { title: 'How to migrate your courses from Moodle', youtubeId: null },
  'migrate-2': { title: 'How to migrate your courses from Open edX', youtubeId: null },
  'migrate-3': { title: 'How to migrate your courses from Canvas', youtubeId: null },

  // LearnHouse Growth: using courses to grow
  'growth-3': { title: 'How to get your online course on Google', youtubeId: null },
  'growth-10': { title: 'How to find out which lessons work', youtubeId: null },
}
