import type {
  MagicLinkRequest,
  MagicLinkResponse,
  ProvisionUserRequest,
  TrailRead,
  UserRead,
} from "../types/learnhouse.ts";

export interface LearnhouseConfig {
  baseUrl: string;   // e.g. https://lms.lanternroute.com
  orgSlug: string;   // e.g. "default"
  adminToken: string;
}

export class LearnhouseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "LearnhouseError";
  }
}

export class LearnhouseClient {
  constructor(private readonly cfg: LearnhouseConfig) {}

  private url(path: string): string {
    return `${this.cfg.baseUrl.replace(/\/$/, "")}/api/v1${path}`;
  }

  private headers(extra?: Record<string, string>): HeadersInit {
    return {
      Authorization: `Bearer ${this.cfg.adminToken}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : (undefined as T);
    return { status: res.status, data };
  }

  /** GET /api/v1/admin/{org_slug}/users/by-email/{email} → UserRead | null. */
  async getUserByEmail(email: string): Promise<UserRead | null> {
    const path = `/admin/${this.cfg.orgSlug}/users/by-email/${encodeURIComponent(email)}`;
    const { status, data } = await this.request<UserRead | { detail: string }>("GET", path);
    if (status === 404) return null;
    if (status !== 200) throw new LearnhouseError(`getUserByEmail failed`, status, data);
    return data as UserRead;
  }

  /** POST /api/v1/admin/{org_slug}/users → UserRead. */
  async provisionUser(body: ProvisionUserRequest): Promise<UserRead> {
    const path = `/admin/${this.cfg.orgSlug}/users`;
    const { status, data } = await this.request<UserRead | { detail: string }>("POST", path, body);
    if (status !== 200) throw new LearnhouseError(`provisionUser failed`, status, data);
    return data as UserRead;
  }

  /**
   * POST /api/v1/admin/{org_slug}/enrollments/{user_id}/{course_uuid}.
   * 400 ("already enrolled") is a benign no-op for us.
   */
  async enrollUser(args: {
    userId: number;
    courseUuid: string;
  }): Promise<{ alreadyEnrolled: boolean; trail: TrailRead | null }> {
    const path = `/admin/${this.cfg.orgSlug}/enrollments/${args.userId}/${args.courseUuid}`;
    const { status, data } = await this.request<TrailRead | { detail: string }>("POST", path);
    if (status === 200) return { alreadyEnrolled: false, trail: data as TrailRead };
    if (status === 400) return { alreadyEnrolled: true, trail: null };
    throw new LearnhouseError(`enrollUser failed`, status, data);
  }

  /** POST /api/v1/admin/{org_slug}/auth/magic-link → MagicLinkResponse. */
  async issueMagicLink(args: MagicLinkRequest): Promise<MagicLinkResponse> {
    const path = `/admin/${this.cfg.orgSlug}/auth/magic-link`;
    const body: MagicLinkRequest = {
      user_id: args.user_id,
      ttl_seconds: args.ttl_seconds ?? 604800, // 7 days, the LH cap
      ...(args.redirect_to !== undefined ? { redirect_to: args.redirect_to } : {}),
    };
    const { status, data } = await this.request<MagicLinkResponse | { detail: string }>(
      "POST",
      path,
      body,
    );
    if (status !== 200) throw new LearnhouseError(`issueMagicLink failed`, status, data);
    return data as MagicLinkResponse;
  }
}
