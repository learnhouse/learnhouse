import { describe, expect, test } from "bun:test";

import {
  courseEndFlags,
  getCourseCompletionConfig,
  getCourseEndConfig,
  isSafeCourseEndLink,
  resolveCourseEndButton,
  resolveSecondaryButton,
} from "../components/Pages/Activity/courseEndConfig.ts";

const org = (course_end) => ({ config: { config: { customization: { course_end } } } });
const course = (course_end) => ({ extra_metadata: course_end === undefined ? {} : { course_end } });

describe("per-course completion screen", () => {
  test("a course without its own config uses the organization's", () => {
    expect(getCourseEndConfig(org({ message: "org" }), course(undefined))).toEqual({ message: "org" });
    expect(getCourseEndConfig(org({ message: "org" }), { extra_metadata: null })).toEqual({ message: "org" });
    expect(getCourseEndConfig(undefined, course(undefined))).toEqual({});
  });

  test("course values win, empty course text falls back to the organization", () => {
    const resolved = getCourseEndConfig(
      org({ message: "org message", button_text: "Org button", button_link: "/library" }),
      course({ message: "Course message", button_text: "  ", button_link: "", show_confetti: false }),
    );
    expect(resolved.message).toBe("Course message");
    expect(resolved.button_text).toBe("Org button");
    expect(resolved.button_link).toBe("/library");
    expect(resolved.show_confetti).toBe(false);
  });

  test("ignores a malformed course config", () => {
    expect(getCourseCompletionConfig(course("nope"))).toBeNull();
    expect(getCourseCompletionConfig(course(["x"]))).toBeNull();
    expect(getCourseCompletionConfig(undefined)).toBeNull();
  });

  test("flags default to on", () => {
    expect(courseEndFlags({})).toEqual({ confetti: true, backButton: true });
    expect(courseEndFlags({ show_confetti: false, show_back_button: false })).toEqual({ confetti: false, backButton: false });
  });

  test("the second button needs a label and a safe link", () => {
    expect(resolveSecondaryButton({})).toBeNull();
    expect(resolveSecondaryButton({ secondary_button_text: "Go" })).toBeNull();
    expect(resolveSecondaryButton({ secondary_button_link: "/x" })).toBeNull();
    expect(resolveSecondaryButton({ secondary_button_text: "Go", secondary_button_link: "javascript:alert(1)" })).toBeNull();
    expect(resolveSecondaryButton({ secondary_button_text: " Go ", secondary_button_link: "/community" })).toEqual({
      text: "Go",
      href: "/community",
      external: false,
    });
    expect(resolveSecondaryButton({ secondary_button_text: "Go", secondary_button_link: "https://x.dev" }).external).toBe(true);
  });

  test("link allowlist", () => {
    expect(isSafeCourseEndLink("/courses")).toBe(true);
    expect(isSafeCourseEndLink("HTTPS://x.dev")).toBe(true);
    for (const bad of ["//evil", "javascript:x", "courses", ""]) expect(isSafeCourseEndLink(bad)).toBe(false);
    expect(resolveCourseEndButton({ button_link: "//evil" }).href).toBe("/courses");
  });
});
