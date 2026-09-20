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

import {
  backgroundCss,
  hasSectionFrame,
  safeHref,
  sanitizeAnchor,
  spacingClass,
} from "../components/Landings/landingSections.ts";
import { LANDING_TEMPLATES } from "../components/Dashboard/Pages/Org/OrgEditLanding/landingTemplates.ts";

describe("section style", () => {
  test("a section saved before styles existed needs no frame and keeps py-16", () => {
    expect(hasSectionFrame(undefined)).toBe(false);
    expect(hasSectionFrame({})).toBe(false);
    expect(hasSectionFrame({ spacing: "large" })).toBe(false);
    expect(spacingClass(undefined)).toBe("py-16");
    expect(spacingClass({ spacing: "bogus" })).toBe("py-16");
  });

  test("hidden sections never render, whatever the audience", () => {
    const hidden = { type: "logos", title: "", logos: [], hidden: true };
    expect(isSectionVisible(hidden, "authenticated")).toBe(false);
    expect(isSectionVisible(hidden, "unauthenticated")).toBe(false);
  });

  test("backgrounds", () => {
    expect(backgroundCss({ type: "solid", color: "#fff" })).toBe("#fff");
    expect(backgroundCss({ type: "gradient", colors: ["#000", "#111"] })).toBe("linear-gradient(45deg, #000, #111)");
    expect(backgroundCss({ type: "gradient", colors: ["#000"] })).toBeUndefined();
    expect(backgroundCss({ type: "image", image: "" })).toBeUndefined();
    expect(backgroundCss({ type: "image", image: 'https://x/a b").png' })).toBe('url("https://x/a b\\").png") center/cover');
  });

  test("anchors become safe ids", () => {
    expect(sanitizeAnchor(" #Our Pricing! ")).toBe("our-pricing");
    expect(sanitizeAnchor('"><script>')).toBe("script");
    expect(sanitizeAnchor("")).toBeUndefined();
    expect(hasSectionFrame({ anchor: "faq" })).toBe(true);
  });

  test("links", () => {
    for (const ok of ["/courses", "#faq", "https://example.com", "mailto:a@b.co", "tel:+100"]) {
      expect(safeHref(ok)).toBe(ok);
    }
    for (const bad of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "", undefined]) {
      expect(safeHref(bad)).toBe("#");
    }
  });
});

describe("templates", () => {
  test("templates are non-empty and never repeat an anchor", () => {
    for (const template of LANDING_TEMPLATES) {
      expect(template.sections.length).toBeGreaterThan(0);
      const anchors = template.sections.map((s) => s.style?.anchor).filter(Boolean);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});

import {
  countdownParts,
  deviceClass,
  isWithinSchedule,
  resolveLandingEmbed,
} from "../components/Landings/landingSections.ts";
import { parseLandingImport, LANDING_SECTION_TYPES } from "../components/Dashboard/Pages/Org/OrgEditLanding/landingImport.ts";

describe("scheduling and devices", () => {
  const now = new Date("2026-09-20T12:00:00");

  test("no bounds, or unparseable bounds, mean always on", () => {
    expect(isWithinSchedule({}, now)).toBe(true);
    expect(isWithinSchedule({ showFrom: "soon", showUntil: "later" }, now)).toBe(true);
  });

  test("window is inclusive of the start and exclusive of the end", () => {
    expect(isWithinSchedule({ showFrom: "2026-09-20T12:00" }, now)).toBe(true);
    expect(isWithinSchedule({ showFrom: "2026-09-21T00:00" }, now)).toBe(false);
    expect(isWithinSchedule({ showUntil: "2026-09-20T12:00" }, now)).toBe(false);
    expect(isWithinSchedule({ showUntil: "2026-09-20T12:01" }, now)).toBe(true);
  });

  test("a scheduled section is filtered out of the page", () => {
    const s = { type: "banner", showUntil: "2026-01-01T00:00" };
    expect(isSectionVisible(s, "unauthenticated", now)).toBe(false);
  });

  test("device classes", () => {
    expect(deviceClass(undefined)).toBe("");
    expect(deviceClass("all")).toBe("");
    expect(deviceClass("desktop")).toBe("hidden md:flex");
    expect(deviceClass("mobile")).toBe("flex md:hidden");
  });

  test("the new style options need a frame, their defaults do not", () => {
    expect(hasSectionFrame({ width: "narrow" })).toBe(true);
    expect(hasSectionFrame({ titleAlign: "center" })).toBe(true);
    expect(hasSectionFrame({ animation: "fade" })).toBe(true);
    expect(hasSectionFrame({ width: "normal", titleAlign: "start", animation: "none" })).toBe(false);
  });
});

describe("embeds", () => {
  test("allowed hosts are framed, known providers are rewritten", () => {
    expect(resolveLandingEmbed("https://calendly.com/acme/intro")).toBe("https://calendly.com/acme/intro");
    expect(resolveLandingEmbed("https://form.typeform.com/to/abc")).toBe("https://form.typeform.com/to/abc");
    expect(resolveLandingEmbed("https://docs.google.com/forms/d/abc/edit")).toBe("https://docs.google.com/forms/d/abc/viewform?embedded=true");
    expect(resolveLandingEmbed("https://www.google.com/maps/embed?pb=x")).toBe("https://www.google.com/maps/embed?pb=x");
  });

  test("everything else renders nothing", () => {
    for (const bad of [
      "",
      "not a url",
      "http://calendly.com/acme",
      "https://evil.example/calendly.com",
      "https://calendly.com.evil.example/x",
      "https://www.google.com/search?q=x",
      "javascript:alert(1)",
    ]) {
      expect(resolveLandingEmbed(bad)).toBeNull();
    }
  });
});

describe("countdown", () => {
  test("splits the remaining time", () => {
    const now = new Date("2026-09-20T12:00:00");
    expect(countdownParts("2026-09-22T13:02:03", now)).toEqual({ days: 2, hours: 1, minutes: 2, seconds: 3, done: false });
  });

  test("past or invalid targets are done, never negative", () => {
    const now = new Date("2026-09-20T12:00:00");
    expect(countdownParts("2026-01-01T00:00", now)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
    expect(countdownParts("nope", now).done).toBe(true);
  });
});

describe("landing import", () => {
  test("accepts an export and keeps settings", () => {
    const text = JSON.stringify({ sections: [{ type: "banner", text: "hi" }], settings: { width: "wide" } });
    expect(parseLandingImport(text)).toEqual({ sections: [{ type: "banner", text: "hi" }], settings: { width: "wide" } });
  });

  test("rejects anything the renderer would not understand", () => {
    for (const bad of [
      "not json",
      "[]",
      JSON.stringify({ sections: [] }),
      JSON.stringify({ sections: [{ type: "script" }] }),
      JSON.stringify({ sections: [null] }),
      JSON.stringify({ sections: "hero" }),
      JSON.stringify({ sections: Array.from({ length: 61 }, () => ({ type: "spacer" })) }),
    ]) {
      expect(parseLandingImport(bad)).toBeNull();
    }
  });

  test("templates only use importable types", () => {
    const known = new Set(LANDING_SECTION_TYPES);
    for (const template of LANDING_TEMPLATES) {
      for (const section of template.sections) expect(known.has(section.type)).toBe(true);
    }
  });
});
