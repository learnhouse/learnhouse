// Anonymous learners who press "Start course" are sent to sign up. They used
// to land on the org home afterwards (no ?next), and only ~1 in 25 ever started
// the course. These pin the ?next plumbing. Synthetic paths only.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readNextParam, withNextParam } from "../lib/auth/nextParam.ts";

describe("readNextParam", () => {
  test("keeps internal paths from next or redirect", () => {
    expect(readNextParam("?next=%2Fcourse%2Fabc")).toBe("/course/abc");
    expect(readNextParam(new URLSearchParams("redirect=/store/offers/x"))).toBe("/store/offers/x");
  });

  test("drops external, protocol-relative and missing destinations", () => {
    expect(readNextParam("?next=https://evil.test")).toBeNull();
    expect(readNextParam("?next=//evil.test")).toBeNull();
    expect(readNextParam("?next=/\\evil.test")).toBeNull();
    expect(readNextParam("")).toBeNull();
    expect(readNextParam(null)).toBeNull();
  });
});

describe("withNextParam", () => {
  test("appends an encoded next", () => {
    expect(withNextParam("/signup", "/course/abc")).toBe("/signup?next=%2Fcourse%2Fabc");
    expect(withNextParam("/signup?invite=1", "/course/abc")).toBe("/signup?invite=1&next=%2Fcourse%2Fabc");
  });

  test("leaves the path alone without a safe destination", () => {
    expect(withNextParam("/login", null)).toBe("/login");
    expect(withNextParam("/login", "https://evil.test")).toBe("/login");
  });
});

describe("call sites", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

  test("the course start prompt sends people back to the course", () => {
    const src = read("../components/Objects/Courses/CourseActions/CoursesActions.tsx");
    expect(src).toContain("withNextParam('/signup', `/course/${cleanCourseUuid}`)");
    expect(src).not.toMatch(/router\.push\(getUriWithOrg\(orgslug, '\/signup'\)\)\n\s*return\n\s*\}\n\n\s*\/\/ Check if user is part/);
  });

  test("signup and login links keep ?next", () => {
    expect(read("../app/auth/signup/OpenSignup.tsx")).not.toContain('<Link href="/login"');
    expect(read("../app/auth/login/login.tsx")).not.toContain('<Link href="/signup"');
  });
});
