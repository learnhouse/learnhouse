import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { Certificate, Certification } from '../models'

export interface CertificateLangOptions extends BaseRequestOptions {
  /** Course names and descriptions in this language, when the course has it. */
  lang?: string
}

/** Course completion certificates. Needs the Pro plan on LearnHouse Cloud. */
export function createCertificatesResource(http: HttpCore) {
  // Named so methods still work when destructured off the resource.
  const resource = {
    /**
     * Every certificate the signed-in user earned, optionally in one org.
     * `GET /api/v1/certifications/user/all`
     */
    listMine(options: CertificateLangOptions & { orgId?: number } = {}): Promise<Certificate[]> {
      const { lang, orgId, ...rest } = options
      return http.GET('/api/v1/certifications/user/all', {
        ...rest,
        params: { query: { lang, org_id: orgId } },
      }) as Promise<Certificate[]>
    },
    /**
     * The signed-in user's certificate for one course (an empty list until
     * they complete it). `GET /api/v1/certifications/user/course/{course_uuid}`
     */
    listMineForCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Certificate[]> {
      return http.GET('/api/v1/certifications/user/course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      }) as Promise<Certificate[]>
    },
    /**
     * One issued certificate by its `user_certification_uuid`, as the public
     * verification page shows it. `GET /api/v1/certifications/certificate/{user_certification_uuid}`
     */
    get(userCertificationUuid: string, options: CertificateLangOptions = {}): Promise<Certificate> {
      const { lang, ...rest } = options
      return http.GET('/api/v1/certifications/certificate/{user_certification_uuid}', {
        ...rest,
        params: { path: { user_certification_uuid: userCertificationUuid }, query: { lang } },
      }) as Promise<Certificate>
    },
    /**
     * Check a certificate id: resolves to the certificate, or `null` when no
     * such certificate exists (404) instead of throwing.
     */
    async verify(userCertificationUuid: string, options: CertificateLangOptions = {}): Promise<Certificate | null> {
      try {
        return await resource.get(userCertificationUuid, options)
      } catch (err) {
        if ((err as { status?: unknown })?.status === 404) return null
        throw err
      }
    },
    /** The certificate a course awards, when it has one. `GET /api/v1/certifications/course/{course_uuid}` */
    getForCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Certification[]> {
      return http.GET('/api/v1/certifications/course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      })
    },
  }
  return resource
}

export type CertificatesResource = ReturnType<typeof createCertificatesResource>
