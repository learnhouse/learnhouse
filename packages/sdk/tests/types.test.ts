// Compile-time checks of the typed request layer. They run under `tsc --noEmit`;
// the vitest side only makes sure the calls are well formed at runtime.
import { describe, expectTypeOf, it } from 'vitest'
import { createClient, type Activity, type CourseMeta, type Organization, type Trail } from '../src'
import { json, mockFetch } from './helpers'

describe('typed request layer', () => {
  it('infers response types from the schema', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: 'http://x', fetch: m.fetch })

    const meta = await client.GET('/api/v1/courses/{course_uuid}/meta', {
      params: { path: { course_uuid: 'c' }, query: { slim: true } },
    })
    expectTypeOf(meta).toEqualTypeOf<CourseMeta>()

    expectTypeOf(client.orgs.get).returns.resolves.toEqualTypeOf<Organization>()
    expectTypeOf(client.activities.get).returns.resolves.toEqualTypeOf<Activity>()
    expectTypeOf(client.trail.completeActivity).returns.resolves.toEqualTypeOf<Trail>()

    // Paths without required params take no options at all.
    await client.GET('/api/v1/users/session')

    if (false as boolean) {
      // @ts-expect-error unknown path
      await client.GET('/api/v1/nope')
      // @ts-expect-error path params are required for this route
      await client.GET('/api/v1/courses/{course_uuid}')
      // @ts-expect-error wrong path param name
      await client.GET('/api/v1/courses/{course_uuid}', { params: { path: { uuid: 'x' } } })
      // @ts-expect-error GET is not declared on this route
      await client.GET('/api/v1/trail/add_activity/{activity_uuid}', { params: { path: { activity_uuid: 'a' } } })
      // @ts-expect-error chapter_id is numeric
      await client.GET('/api/v1/chapters/{chapter_id}', { params: { path: { chapter_id: 'x' } } })
      // @ts-expect-error the body is required
      await client.POST('/api/v1/trail/start')
    }
  })
})
