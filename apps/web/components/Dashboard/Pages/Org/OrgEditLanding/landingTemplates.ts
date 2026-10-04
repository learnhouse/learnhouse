import { LandingSection } from './landing_types'

export interface LandingTemplate {
  id: 'academy' | 'launch' | 'product' | 'minimal'
  sections: LandingSection[]
}

// Starter content. It is sample copy meant to be overwritten, so it is not
// translated; only the template names are (see `landing.templates.*`).
export const LANDING_TEMPLATES: LandingTemplate[] = [
  {
    id: 'academy',
    sections: [
      {
        type: 'hero',
        title: 'Hero',
        visibility: 'logged_out',
        background: { type: 'gradient', colors: ['#0f172a', '#1e3a8a'], direction: '135deg' },
        heading: { text: 'Learn the skills that move your career', color: '#ffffff', size: 'large' },
        subheading: { text: 'Practical courses, real projects, and a community that has your back.', color: '#cbd5e1', size: 'medium' },
        buttons: [
          { text: 'Create your account', link: '/signup', color: '#0f172a', background: '#ffffff' },
          { text: 'How it works', link: '#how-it-works', color: '#ffffff', background: '#1d4ed8' },
        ],
        contentAlign: 'center',
      },
      {
        type: 'hero',
        title: 'Hero',
        visibility: 'logged_in',
        background: { type: 'gradient', colors: ['#064e3b', '#059669'], direction: '135deg' },
        heading: { text: 'Welcome back', color: '#ffffff', size: 'large' },
        subheading: { text: 'Pick up where you left off.', color: '#d1fae5', size: 'medium' },
        buttons: [{ text: 'Go to my courses', link: '/courses', color: '#064e3b', background: '#ffffff' }],
        contentAlign: 'center',
      },
      {
        type: 'stats',
        title: '',
        items: [
          { value: '12k+', label: 'Learners' },
          { value: '80', label: 'Courses' },
          { value: '4.9/5', label: 'Average rating' },
          { value: '35', label: 'Countries' },
        ],
      },
      {
        type: 'features',
        title: 'How it works',
        subtitle: 'Three steps from curious to confident.',
        columns: 3,
        style: { anchor: 'how-it-works' },
        items: [
          { icon: '🎯', title: 'Pick a path', description: 'Choose a course that matches your goal and your level.' },
          { icon: '🛠️', title: 'Learn by doing', description: 'Short lessons, hands-on assignments, instant feedback.' },
          { icon: '🏆', title: 'Earn your certificate', description: 'Finish the course and share a verifiable certificate.' },
        ],
      },
      { type: 'featured-courses', title: 'Latest courses', courses: [], mode: 'latest', limit: 4 },
      {
        type: 'testimonials',
        title: 'What learners say',
        style: { background: { type: 'solid', color: '#f1f5f9' } },
        items: [
          { quote: 'The projects made everything click. I shipped my first app in a month.', author: 'Amira K.', role: 'Junior developer', image_url: '' },
          { quote: 'Clear, practical, and no filler. Exactly what I needed.', author: 'Jonas P.', role: 'Freelancer', image_url: '' },
          { quote: 'The best onboarding our team has ever had.', author: 'Lea M.', role: 'Team lead', image_url: '' },
        ],
      },
      {
        type: 'faq',
        title: 'Frequently asked questions',
        style: { anchor: 'faq' },
        items: [
          { question: 'Do I need prior experience?', answer: 'No. Every course states its level, and beginner courses start from zero.' },
          { question: 'How long do I keep access?', answer: 'For as long as your account is active.' },
          { question: 'Do I get a certificate?', answer: 'Yes, courses with certification issue one as soon as you finish.' },
        ],
      },
      {
        type: 'cta',
        visibility: 'logged_out',
        heading: 'Ready to start?',
        text: 'Create a free account and take your first lesson today.',
        background: { type: 'gradient', colors: ['#581c87', '#7e22ce'], direction: '90deg' },
        textColor: '#ffffff',
        buttons: [{ text: 'Sign up', link: '/signup', color: '#581c87', background: '#ffffff' }],
      },
    ],
  },
  {
    id: 'launch',
    sections: [
      { type: 'banner', text: 'Early-bird pricing ends when the timer hits zero', linkText: 'See plans', link: '#pricing', background: '#7c2d12', textColor: '#ffffff' },
      {
        type: 'hero',
        title: 'Hero',
        height: 'large',
        background: { type: 'gradient', colors: ['#7c2d12', '#c2410c'], direction: '135deg' },
        heading: { text: 'The cohort that gets you hired', color: '#ffffff', size: 'large' },
        subheading: { text: 'Eight weeks, live sessions, real projects, one goal.', color: '#fed7aa', size: 'medium' },
        buttons: [{ text: 'Reserve your seat', link: '#pricing', color: '#7c2d12', background: '#ffffff' }],
        contentAlign: 'center',
      },
      // Empty target: the editor fills in "a week from now" when the template is applied.
      { type: 'countdown', heading: 'Doors close in', text: '', target: '', doneText: 'Enrollment is closed. Join the waitlist!', buttons: [], style: { spacing: 'small' } },
      {
        type: 'steps',
        title: 'How the cohort works',
        layout: 'horizontal',
        style: { animation: 'slide-up' },
        items: [
          { title: 'Join', description: 'Pick a plan and meet your cohort.' },
          { title: 'Build', description: 'Ship one project every two weeks, with reviews.' },
          { title: 'Show', description: 'Present your portfolio on demo day.' },
          { title: 'Land it', description: 'Interview prep and introductions.' },
        ],
      },
      {
        type: 'columns',
        title: '',
        style: { background: { type: 'solid', color: '#fff7ed' }, animation: 'fade' },
        items: [
          { content: '### Live, not recorded\nTwo sessions a week with instructors who do this for a living.' },
          { content: '### Small groups\nCapped at **30 learners**, so every question gets an answer.' },
          { content: '### Yours to keep\nLifetime access to every lesson and update.' },
        ],
      },
      {
        type: 'pricing',
        title: 'Pick your plan',
        subtitle: 'Prices go up when the countdown ends.',
        style: { anchor: 'pricing', animation: 'slide-up' },
        plans: [
          { name: 'Self-paced', price: '$149', period: 'once', description: 'All lessons, no live sessions.', features: 'Every lesson\nProject briefs\nCommunity access', highlighted: false, button: { text: 'Choose self-paced', link: '/signup', color: '#0f172a', background: '#f1f5f9' } },
          { name: 'Cohort', price: '$399', period: 'once', description: 'The full live experience.', features: 'Everything in Self-paced\nTwo live sessions a week\nProject reviews\nCertificate', highlighted: true, button: { text: 'Join the cohort', link: '/signup', color: '#ffffff', background: '#c2410c' } },
          { name: 'Team', price: '$299', period: '/ seat', description: 'For three seats or more.', features: 'Everything in Cohort\nPrivate team channel\nProgress reports', highlighted: false, button: { text: 'Talk to us', link: 'mailto:hello@example.com', color: '#0f172a', background: '#f1f5f9' } },
        ],
      },
      {
        type: 'faq',
        title: 'Questions',
        style: { width: 'narrow' },
        items: [
          { question: 'What if I miss a live session?', answer: 'Every session is recorded and posted the same day.' },
          { question: 'Is there a refund?', answer: 'Yes, a full refund during the first week.' },
        ],
      },
    ],
  },
  {
    id: 'product',
    sections: [
      {
        type: 'hero',
        title: 'Hero',
        background: { type: 'solid', color: '#ffffff' },
        heading: { text: 'Everything you need to master the product', color: '#0f172a', size: 'large' },
        subheading: { text: 'Guides, walkthroughs and certifications for customers and partners.', color: '#475569', size: 'medium' },
        buttons: [{ text: 'Browse courses', link: '/courses', color: '#ffffff', background: '#0f172a' }],
        contentAlign: 'left',
      },
      { type: 'video', title: 'Take the 2-minute tour', description: '', url: '' },
      {
        type: 'features',
        title: 'What you will learn',
        subtitle: '',
        columns: 4,
        items: [
          { icon: '🚀', title: 'Getting started', description: 'Set up your workspace in minutes.' },
          { icon: '⚙️', title: 'Configuration', description: 'Make it fit the way your team works.' },
          { icon: '📊', title: 'Reporting', description: 'Turn activity into decisions.' },
          { icon: '🔐', title: 'Administration', description: 'Roles, security and governance.' },
        ],
      },
      { type: 'featured-courses', title: 'Start here', courses: [], mode: 'latest', limit: 4 },
      {
        type: 'cta',
        heading: 'Need a hand?',
        text: 'Our team is one message away.',
        background: { type: 'solid', color: '#0f172a' },
        textColor: '#ffffff',
        buttons: [{ text: 'Contact us', link: 'mailto:hello@example.com', color: '#0f172a', background: '#ffffff' }],
      },
    ],
  },
  {
    id: 'minimal',
    sections: [
      {
        type: 'rich-text',
        title: 'Welcome',
        content: 'A short introduction to your school. **Markdown** is supported, including [links](/courses) and lists.',
        align: 'center',
      },
      { type: 'featured-courses', title: 'Courses', courses: [], mode: 'latest', limit: 8 },
    ],
  },
]
