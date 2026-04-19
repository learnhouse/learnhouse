// Mirrors of LearnHouse admin API request/response models.
// Source of truth: apps/api/src/routers/admin.py:154-178
//                  apps/api/src/db/users.py (UserRead)
// Keep field names + types byte-for-byte identical so drift is visible in PRs.

export interface ProvisionUserRequest {
  email: string;
  username: string;
  first_name?: string;
  last_name?: string;
  password?: string | null;
  role_id?: number; // default 4 = student
}

export interface UserRead {
  id: number;
  user_uuid: string;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  email_verified: boolean;
  avatar_image: string | null;
  bio: string | null;
  details: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  last_login_at: string | null;
  signup_method: string | null;
  is_superadmin: boolean;
}

export interface MagicLinkRequest {
  user_id: number;
  redirect_to?: string;
  // 60..604800 (7 days). Code clamp at apps/api/src/services/admin/admin.py:946.
  ttl_seconds?: number;
}

export interface MagicLinkResponse {
  url: string;
  token: string;
  expires_at: string; // ISO8601
}

export interface TrailRead {
  id: number;
  trail_uuid: string;
  user_id: number;
  org_id: number;
  runs: unknown[];
}
