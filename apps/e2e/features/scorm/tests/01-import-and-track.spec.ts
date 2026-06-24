/**
 * Core SCORM flow against a live EE instance:
 *   admin uploads + imports a multi-SCO 1.2 package (one shared content root) ->
 *   a student initializes the runtime, commits a completion + score with
 *   cumulative session_time across two commits ->
 *   the server records completion + score and a SANE total_time (no double-count) ->
 *   the instructor sees the learner's result via the reporting endpoint.
 *
 * Requires Enterprise Edition (SCORM). Run against a `dev --ee` / EE stack:
 *   E2E_BASE_URL=http://localhost:3000 bun run test features/scorm
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeStudent } from '../../../core/instance'
import {
  login, getOrg, createStudent, seedScorm,
  runtimeInitialize, runtimeCommit, getRuntimeData, getResults,
} from '../api'

test('multi-SCO import, learner tracking, completion + instructor results', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()

  const seed = await seedScorm(admin, org, `SCORM Track ${Date.now()}`, 'valid_12_multi.zip')
  expect(seed.activities.length).toBe(3) // 3 SCOs imported as 3 activities

  // All three activities should share one SCORM package (storage de-dup) — they
  // resolve content fine, which we assert indirectly via runtime + results below.
  const activityUuid = seed.activities[0].activity_uuid

  const student = makeStudent('scorm')
  await createStudent(admin, org.id, {
    email: student.email, username: student.username, password: student.password,
    first_name: student.firstName, last_name: student.lastName,
  })
  const studentToken = await login(student.email, student.password)

  const init = await runtimeInitialize(studentToken, activityUuid)
  expect(init.cmi_data['cmi.core.entry']).toBe('ab-initio')

  // First commit: completed + score, 60s into the session.
  await runtimeCommit(studentToken, activityUuid, {
    'cmi.core.lesson_status': 'completed',
    'cmi.core.score.raw': '88',
    'cmi.core.session_time': '00:01:00',
  })
  // Second commit: SCO reports cumulative session_time (120s) — must NOT add up.
  await runtimeCommit(studentToken, activityUuid, {
    'cmi.core.session_time': '00:02:00',
  })

  const data = await getRuntimeData(studentToken, activityUuid)
  expect(data.completion_status).toBe('completed')
  expect(data.score_raw).toBe(88)
  expect(data.total_time).toBe('PT2M') // 120s, not the buggy 180s

  // Instructor reporting: sees exactly this learner's result.
  const results = await getResults(admin, activityUuid)
  expect(results.length).toBe(1)
  expect(results[0].email).toBe(student.email)
  expect(results[0].completion_status).toBe('completed')
  expect(results[0].score_raw).toBe(88)

  // A learner must NOT be able to read the results listing.
  await expect(getResults(studentToken, activityUuid)).rejects.toThrow(/40[13]/)
})
