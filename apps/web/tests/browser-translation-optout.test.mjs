import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");

/**
 * Chrome, Edge, Yandex and Chrome on Android replace text nodes with <font>
 * wrappers they insert themselves. React's fibers still point at the originals,
 * so its next commit can call insertBefore/removeChild against a node that is no
 * longer a child of the parent it recorded and the page dies:
 * "NotFoundError: Failed to execute 'insertBefore' on 'Node'".
 *
 * WHAT THIS FILE DOES NOT CLAIM. It does not pin a fix for LEARNHOUSE-WEB-5M /
 * -6A / -6J. Those were originally attributed to browser translation and the
 * attribution does not hold: the dash has carried translate="no" AND the
 * `notranslate` class since 4080d4ca (2026-07-25), a month before 6A's first
 * event, and 6A's 14 events span routes both inside and outside that subtree on
 * three browser builds. The stacks are minified React internals with no app
 * frame and no source maps. Those issues are unexplained and stay open; the
 * root opt-out is hardening against a documented failure mode, nothing more.
 *
 * What IS pinned is the shape of that hardening, because it is easy to break in
 * a way nothing else notices. The attribute sits on <body> because React portals
 * (every Radix dialog and dropdown, the toaster) mount into document.body,
 * outside any inner wrapper, and `translate` is inherited so one attribute
 * reaches them.
 *
 * Turning translation off site-wide would be a regression on its own — readers
 * on a foreign locale do use the browser translator on course content. So the
 * shape here is BOTH halves: off at the root, back on for the authored course
 * prose, which ProseMirror renders and React never reconciles.
 */
describe("browser page translation is opted out at the document root", () => {
  const layout = readFileSync(join(WEB, "app/layout.tsx"), "utf8");
  // The opening <body> element with its attributes — prose mentions of `<body>`
  // in the comment above it have no attributes and are skipped by the \s.
  const bodyTag = (layout.match(/<body\s[^>]*>/) ?? [""])[0];

  test("the root layout's <body> carries translate=\"no\"", () => {
    expect(bodyTag).not.toBe("");
    expect(bodyTag).toContain('translate="no"');
  });

  test("<body> does NOT carry the notranslate class", () => {
    // Not an oversight. `translate` is an HTML-inherited state a descendant can
    // flip back on with translate="yes"; the legacy `notranslate` class makes a
    // translation traversal skip the subtree outright, with no documented way
    // back in. Adding it here would silently kill the DynamicCanva re-enable
    // below and take learner-facing course content offline for translation
    // again — the exact regression this pair of describes exists to prevent.
    expect(bodyTag).not.toContain("notranslate");
  });

  test("nothing re-enables translation above the app tree", () => {
    // A translate="yes" is legitimate on a learner-content subtree, but not on
    // the elements that wrap everything.
    expect(layout).not.toContain('<html translate="yes"');
    expect(layout).not.toMatch(/<main[^>]*translate="yes"/);
  });
});

/**
 * The compensating half. Without this the root-level opt-out is a product-wide
 * regression: LearnHouse ships 21 locales and readers on a foreign locale use
 * the browser translator to read course content.
 */
describe("authored course content stays machine-translatable", () => {
  const canva = readFileSync(
    join(WEB, "components/Objects/Activities/DynamicCanva/DynamicCanva.tsx"),
    "utf8",
  );

  test("the ProseMirror content surface re-enables translation", () => {
    expect(canva).toMatch(/<EditorContent[^>]*translate="yes"/);
  });

  test("the re-enable is scoped to EditorContent, not the whole wrapper", () => {
    // canva-content-wrapper also holds TableOfContents, a plain React list that
    // re-renders on every editor update — exactly the React-reconciled shape the
    // root opt-out is there to protect.
    const wrapper = canva.match(/<div className="canva-content-wrapper"[^>]*>/);
    expect(wrapper).not.toBeNull();
    expect(wrapper[0]).not.toContain("translate=");
    expect(canva).not.toMatch(/<TableOfContents[^>]*translate="yes"/);
  });
});

/**
 * Pins WHY the attribute has to live on <body>: modals do not render inside the
 * React tree that declares it. If Modal ever stops portalling, the body-level
 * placement could be argued down again — this fails first.
 */
describe("modals render through a portal, outside any inner wrapper", () => {
  const modal = readFileSync(
    join(WEB, "components/Objects/StyledElements/Modal/Modal.tsx"),
    "utf8",
  );
  const dialog = readFileSync(join(WEB, "components/ui/dialog.tsx"), "utf8");

  test("Modal renders its content through the shared Dialog", () => {
    expect(modal).toContain("<DialogContent");
  });

  test("DialogContent mounts into a Radix portal", () => {
    expect(dialog).toContain("DialogPrimitive.Portal");
    expect(dialog).toContain("<DialogPortal>");
  });
});
