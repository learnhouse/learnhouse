// Built-in templates every organization starts with: small, working examples
// of dynamic content that authors can insert and adapt. Not stored, not
// deletable; saved templates sit next to them.
import type { EditorTemplate } from '@services/courses/dynamicContent'

const text = (value: string) => ({ type: 'text', text: value })
const variable = (path: string, fallback = '') => ({ type: 'dynamicVariable', attrs: { path, fallback, format: null } })
const para = (...inline: any[]) => ({ type: 'paragraph', content: inline })
const block = (label: string, rules: any, content: any[], hiddenMessage = '') => ({
  type: 'conditionalBlock',
  attrs: { rules, label, hiddenMessage },
  content,
})
const doc = (...content: any[]) => ({ type: 'doc', content })

function starter(id: string, name: string, description: string, content: any): EditorTemplate {
  return {
    id: 0,
    template_uuid: `starter:${id}`,
    org_id: 0,
    creator_id: null,
    name,
    description,
    kind: 'block',
    content,
    creation_date: '',
    update_date: '',
  }
}

const half = { match: 'all', conditions: [{ field: 'user.bucket', op: 'lt', value: 50 }] }

export const STARTER_TEMPLATES: EditorTemplate[] = [
  starter(
    'welcome',
    'Personal welcome',
    'Greets each learner by name with their progress',
    doc(para(
      text('Welcome back, '), variable('user.first_name', 'there'), text('! You are '),
      variable('progress.percent'), text('% through '), variable('course.name'), text('.'),
    )),
  ),
  starter(
    'drip',
    'Unlock after a week',
    'Released 7 days after enrolling, with a note until then',
    doc(block(
      'After a week',
      { match: 'all', conditions: [{ field: 'course.enrolled', op: 'is_true' }, { field: 'enrollment.days', op: 'gte', value: 7 }] },
      [para(text('One week in: here is your next challenge.'))],
      'This unlocks after your first week.',
    )),
  ),
  starter(
    'ab',
    'A/B test',
    'Two versions, each shown to a stable half of learners',
    doc(
      block('Version A', half, [para(text('Version A: half of learners see this.'))]),
      block('Version B', { ...half, negate: true }, [para(text('Version B: the other half see this.'))]),
    ),
  ),
  starter(
    'nudge',
    'Keep going',
    'Encourages learners who are not halfway yet',
    doc(block(
      'Under halfway',
      { match: 'all', conditions: [{ field: 'course.enrolled', op: 'is_true' }, { field: 'progress.percent', op: 'lt', value: 50 }] },
      [para(text('You have '), variable('progress.remaining'), text(' activities left. Keep going, '), variable('user.first_name', 'friend'), text('!'))],
    )),
  ),
  starter(
    'complete',
    'Course complete',
    'Congratulates learners who finished the course',
    doc(block(
      'Finished',
      { match: 'all', conditions: [{ field: 'course.completed', op: 'is_true' }] },
      [para(text('Congratulations '), variable('user.first_name'), text(', you finished '), variable('course.name'), text('!'))],
    )),
  ),
  starter(
    'visitors',
    'Sign-in prompt',
    'Only shown to people browsing without an account',
    doc(block(
      'Signed-out visitors',
      { match: 'all', conditions: [{ field: 'user.signed_in', op: 'is_false' }] },
      [para(text('Sign in to save your progress and unlock every lesson.'))],
    )),
  ),
  starter(
    'buddy',
    'Buddy introduction',
    'A fill-in field: you type the buddy name when inserting',
    doc(para(text('Your buddy this week is {{field.buddy_name}}. Say hi in the team channel!'))),
  ),
]

export function isStarter(template: EditorTemplate): boolean {
  return template.template_uuid.startsWith('starter:')
}
