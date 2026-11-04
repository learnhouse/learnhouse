// Who gets the platform hub (workspace switcher, create organization, demo) and
// where an auth flow lands by default. A school's members only see the school.

import { describe, expect, test } from "bun:test";

import {
  hasManagingRoleFromSession,
  managesAnyOrgFromSession,
  seesPlatformHubFromSession,
} from "../components/Hooks/useAdminStatus.tsx";
import { defaultPostAuthPath } from "../services/auth/redirects.ts";

const role = (orgId, canUpdateOrg, extra = {}) => ({
  org: { id: orgId, org_uuid: `org_${orgId}`, ...extra },
  role: { rights: { organizations: { action_update: canUpdateOrg } } },
});
const session = (roles, user = {}) => ({ data: { user, roles } });

describe("managesAnyOrgFromSession", () => {
  test("a member of one school does not run an organization", () => {
    expect(managesAnyOrgFromSession(session([role(1, false)]))).toBe(false);
  });

  test("a member of several schools still does not", () => {
    expect(managesAnyOrgFromSession(session([role(1, false), role(2, false)]))).toBe(false);
  });

  test("an admin of any organization does", () => {
    expect(managesAnyOrgFromSession(session([role(1, false), role(2, true)]))).toBe(true);
  });

  test("the demo sandbox, which makes every visitor an admin, does not count", () => {
    expect(managesAnyOrgFromSession(session([role(1, false), role(9, true, { is_demo: true })]))).toBe(false);
  });

  test("a superadmin does", () => {
    expect(managesAnyOrgFromSession(session([], { is_superadmin: true }))).toBe(true);
  });

  test("no session, no roles", () => {
    expect(managesAnyOrgFromSession(undefined)).toBe(false);
    expect(managesAnyOrgFromSession(session(undefined))).toBe(false);
  });
});

describe("seesPlatformHubFromSession", () => {
  test("people who run an organization do", () => {
    expect(seesPlatformHubFromSession(session([role(1, true)]))).toBe(true);
  });

  test("a prospect whose only organization is the demo does", () => {
    expect(seesPlatformHubFromSession(session([role(9, true, { is_demo: true })]))).toBe(true);
  });

  test("members of schools don't, even with the demo on the side", () => {
    expect(seesPlatformHubFromSession(session([role(1, false)]))).toBe(false);
    expect(seesPlatformHubFromSession(session([role(1, false), role(9, true, { is_demo: true })]))).toBe(false);
  });

  test("no roles, no hub", () => {
    expect(seesPlatformHubFromSession(session([]))).toBe(false);
  });
});

describe("hasManagingRoleFromSession", () => {
  test("only an org-managing role in that org counts, not superadmin", () => {
    const s = session([role(1, false), role(2, true)], { is_superadmin: true });
    expect(hasManagingRoleFromSession(s, 1)).toBe(false);
    expect(hasManagingRoleFromSession(s, 2)).toBe(true);
    expect(hasManagingRoleFromSession(s, 3)).toBe(false);
  });
});

describe("defaultPostAuthPath", () => {
  test("a school's own host lands on the school", () => {
    expect(defaultPostAuthPath({ id: 1, slug: "acme" })).toBe("/");
  });

  test("the org-less apex lands on the hub", () => {
    expect(defaultPostAuthPath(null)).toBe("/home");
    expect(defaultPostAuthPath(undefined)).toBe("/home");
  });
});
