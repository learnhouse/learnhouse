/**
 * SCORM 2004 resume: a learner suspends mid-activity; relaunching restores the
 * bookmark + suspend_data and reports entry="resume", and the initial CMI uses
 * a valid 2004 completion_status token.
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeStudent } from '../../../core/instance'
import {
  login, getOrg, createStudent, seedScorm, runtimeInitialize, runtimeCommit,
} from '../api'

const VALID_2004_COMPLETION = ['completed', 'incomplete', 'not attempted', 'unknown']

test('SCORM 2004 suspend + resume restores state', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const seed = await seedScorm(admin, org, `SCORM Resume ${Date.now()}`, 'valid_2004_single.zip')
  const activityUuid = seed.activities[0].activity_uuid

  const student = makeStudent('resume')
  await createStudent(admin, org.id, {
    email: student.email, username: student.username, password: student.password,
    first_name: student.firstName, last_name: student.lastName,
  })
  const token = await login(student.email, student.password)

  const first = await runtimeInitialize(token, activityUuid)
  expect(first.cmi_data['cmi.entry']).toBe('ab-initio')
  expect(VALID_2004_COMPLETION).toContain(first.cmi_data['cmi.completion_status'])

  await runtimeCommit(token, activityUuid, {
    'cmi.completion_status': 'incomplete',
    'cmi.location': 'slide-5',
    'cmi.suspend_data': 'progress-blob',
    'cmi.exit': 'suspend',
  })

  const again = await runtimeInitialize(token, activityUuid)
  expect(again.cmi_data['cmi.entry']).toBe('resume')
  expect(again.cmi_data['cmi.location']).toBe('slide-5')
  expect(again.cmi_data['cmi.suspend_data']).toBe('progress-blob')
  expect(VALID_2004_COMPLETION).toContain(again.cmi_data['cmi.completion_status'])
  // Write-only elements must not be echoed back to content.
  expect(again.cmi_data['cmi.exit']).toBeUndefined()
  expect(again.cmi_data['cmi.session_time']).toBeUndefined()
})
