import { describe, expect, test } from "bun:test";

import { isSectionVisible, resolveLandingVideo } from "../components/Landings/landingSections.ts";
import { getCourseEndConfig, resolveCourseEndButton } from "../components/Pages/Activity/courseEndConfig.ts";

const section = (visibility) => ({ type: "logos", title: "", logos: [], visibility });

describe("isSectionVisible", () => {
  test("sections saved before the field existed show to everyone", () => {
    for (const status of ["loading", "authenticated", "unauthenticated"]) {
      expect(isSectionVisible(section(undefined), status)).toBe(true);
      expect(isSectionVisible(section("everyone"), status)).toBe(true);
    }
  });

  test("logged_in sections show only to authenticated visitors", () => {
    expect(isSectionVisible(section("logged_in"), "authenticated")).toBe(true);
    expect(isSectionVisible(section("logged_in"), "unauthenticated")).toBe(false);
  });

  test("logged_out sections show only to anonymous visitors", () => {
    expect(isSectionVisible(section("logged_out"), "unauthenticated")).toBe(true);
    expect(isSectionVisible(section("logged_out"), "authenticated")).toBe(false);
  });

  test("audience-restricted sections wait for the session to settle", () => {
    expect(isSectionVisible(section("logged_in"), "loading")).toBe(false);
    expect(isSectionVisible(section("logged_out"), "loading")).toBe(false);
  });
});

describe("resolveLandingVideo", () => {
  test("known hosts become embeds", () => {
    expect(resolveLandingVideo("https://www.youtube.com/watch?v=abc123")).toEqual({
      kind: "embed",
      src: "https://www.youtube.com/embed/abc123?autoplay=0&rel=0",
    });
    expect(resolveLandingVideo("https://vimeo.com/12345")).toEqual({
      kind: "embed",
      src: "https://player.vimeo.com/video/12345",
    });
    expect(resolveLandingVideo("https://www.loom.com/share/xyz").src).toBe(
      "https://www.loom.com/embed/xyz"
    );
  });

  test("other http(s) URLs are played as files, never framed", () => {
    expect(resolveLandingVideo("https://cdn.example.com/tour.mp4")).toEqual({
      kind: "file",
      src: "https://cdn.example.com/tour.mp4",
    });
    expect(resolveLandingVideo("https://example.com/some-page").kind).toBe("file");
  });

  test("empty and non-http values render nothing", () => {
    expect(resolveLandingVideo("")).toBeNull();
    expect(resolveLandingVideo(undefined)).toBeNull();
    expect(resolveLandingVideo("javascript:alert(1)")).toBeNull();
    expect(resolveLandingVideo("data:text/html,x")).toBeNull();
  });
});

describe("course end config", () => {
  test("reads v2 then v1 locations, defaulting to empty", () => {
    expect(getCourseEndConfig({ config: { config: { customization: { course_end: { message: "a" } } } } })).toEqual({ message: "a" });
    expect(getCourseEndConfig({ config: { config: { general: { course_end: { message: "b" } } } } })).toEqual({ message: "b" });
    expect(getCourseEndConfig(undefined)).toEqual({});
  });

  test("defaults to the course catalog", () => {
    expect(resolveCourseEndButton({})).toEqual({ text: null, href: "/courses", external: false });
  });

  test("keeps internal paths and absolute URLs", () => {
    expect(resolveCourseEndButton({ button_text: " Next ", button_link: "/library" })).toEqual({
      text: "Next",
      href: "/library",
      external: false,
    });
    expect(resolveCourseEndButton({ button_link: "https://example.com/x" })).toEqual({
      text: null,
      href: "https://example.com/x",
      external: true,
    });
  });

  test("unsafe links fall back to the default", () => {
    for (const link of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "courses"]) {
      expect(resolveCourseEndButton({ button_link: link }).href).toBe("/courses");
    }
  });
});
