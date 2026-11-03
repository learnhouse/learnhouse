// Video guides embedded in the docs with <YouTube video="..." />.
//
// A slot renders nothing until its `youtubeId` is set, so pages can reference
// a video before it is published. To turn one on, paste the ID from the
// YouTube URL (https://www.youtube.com/watch?v=<ID>) into `youtubeId`.
export const VIDEOS = {
  // Getting started: one-minute walkthroughs of a new academy
  'start-tour': { title: 'A one-minute tour of your new academy', youtubeId: '5UNjzIuEAl0' },
  'start-first-course': { title: 'Create your first course', youtubeId: 'UUnoT-xfnnY' },
  'start-first-lesson': { title: 'Add your first lesson', youtubeId: null },
  'start-branding': { title: 'Make your academy look like your brand', youtubeId: null },
  'start-open-school': { title: 'Open your school to learners', youtubeId: null },
  'start-invite': { title: 'Invite your first learners', youtubeId: 'flESwP0B87g' },
  'start-community': { title: 'Start a community', youtubeId: null },

  // Feature demos
  'feature-drip': { title: 'Drip content: release a course one chapter at a time', youtubeId: null },
  'feature-paths': { title: 'Learning paths: several courses, one certificate', youtubeId: null },
  'feature-dynamic-content': { title: 'Dynamic content: lessons that adapt to each learner', youtubeId: null },
  'feature-payments': { title: 'Payments: sell anything you make', youtubeId: null },
  'feature-live-sessions': { title: 'Live sessions: teach live inside your academy', youtubeId: null },

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
  'growth-1': { title: 'How to turn what you know into an online course', youtubeId: null },
  'growth-2': { title: 'How to get customers with a free course', youtubeId: null },
  'growth-3': { title: 'How to get your online course on Google', youtubeId: null },
  'growth-4': { title: 'How to onboard customers with a course', youtubeId: null },
  'growth-5': { title: 'How to get learners to finish your online course', youtubeId: null },
  'growth-6': { title: 'How to grow a community around your courses', youtubeId: null },
  'growth-7': { title: 'How to turn your docs and videos into course lessons', youtubeId: null },
  'growth-8': { title: 'How to run live classes that convert', youtubeId: null },
  'growth-9': { title: 'How to turn one idea into lessons, podcasts and discussions', youtubeId: null },
  'growth-10': { title: 'How to find out which lessons work', youtubeId: null },
  'growth-11': { title: 'How to build online courses with Claude and ChatGPT', youtubeId: null },
  'growth-12': { title: 'New ways to grow your academy: LMS import, AI search and landing pages', youtubeId: null },
}
