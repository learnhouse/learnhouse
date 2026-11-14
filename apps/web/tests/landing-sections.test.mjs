import { describe, expect, test } from "bun:test";

import { countdownParts, resolveLandingVideo, resolvePricingPlan, safeHref } from "../components/LandingPages/render/helpers.ts";
import { getCourseEndConfig, resolveCourseEndButton } from "../components/Pages/Activity/courseEndConfig.ts";

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

describe("links", () => {
  test("links", () => {
    for (const ok of ["/courses", "#faq", "https://example.com", "mailto:a@b.co", "tel:+100"]) {
      expect(safeHref(ok)).toBe(ok);
    }
    for (const bad of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "", undefined]) {
      expect(safeHref(bad)).toBe("#");
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

describe("pricing plans linked to store offers", () => {
  const fmt = (amount, currency) => `${currency} ${amount}`;
  const plan = (patch = {}) => ({
    name: "", price: "$10", period: "", description: "", features: "", highlighted: false,
    button: { text: "Buy", link: "/signup", color: "#fff", background: "#000" },
    ...patch,
  });
  const offer = {
    offer_uuid: "offer_1", name: "Pro", description: "Everything", offer_type: "subscription",
    price_type: "fixed_price", amount: 29, currency: "USD", benefits: "All courses, Certificates",
  };

  test("an unlinked plan is untouched, with or without offers loaded", () => {
    const p = plan({ name: "Free", features: "One\n\n Two " });
    for (const offers of [undefined, [], [offer]]) {
      const r = resolvePricingPlan(p, offers, fmt);
      expect(r.price).toBe("$10");
      expect(r.features).toEqual(["One", "Two"]);
      expect(r.button.link).toBe("/signup");
      expect(r.loading).toBe(false);
    }
  });

  test("a linked plan takes price, checkout link and empty fields from the offer", () => {
    const r = resolvePricingPlan(plan({ offer_uuid: "offer_1" }), [offer], fmt);
    expect(r.price).toBe("USD 29");
    expect(r.name).toBe("Pro");
    expect(r.description).toBe("Everything");
    expect(r.features).toEqual(["All courses", "Certificates"]);
    expect(r.button.link).toBe("/store/offers/offer_1");
    expect(r.button.text).toBe("Buy");
    expect(r.subscription).toBe(true);
    expect(r.priceIsMinimum).toBe(false);
  });

  test("typed name, description and features win over the offer's; the price never does", () => {
    const r = resolvePricingPlan(plan({ offer_uuid: "offer_1", name: "Team", description: "Mine", features: "A", price: "$1" }), [offer], fmt);
    expect([r.name, r.description, r.features, r.price]).toEqual(["Team", "Mine", ["A"], "USD 29"]);
  });

  test("pay-what-you-want offers flag the price as a minimum", () => {
    const r = resolvePricingPlan(plan({ offer_uuid: "offer_1" }), [{ ...offer, price_type: "customer_choice" }], fmt);
    expect(r.priceIsMinimum).toBe(true);
  });

  test("a linked subscription takes its billing period from the offer, not the typed period", () => {
    const yearly = resolvePricingPlan(plan({ offer_uuid: "offer_1", period: "/ month" }), [{ ...offer, billing_interval: "year" }], fmt);
    expect(yearly.period).toBe("");
    expect(yearly.billingInterval).toBe("year");
    // Offers saved before the period existed renew monthly.
    expect(resolvePricingPlan(plan({ offer_uuid: "offer_1" }), [offer], fmt).billingInterval).toBe("month");
  });

  test("one-time offers keep the typed period and carry no billing period", () => {
    const r = resolvePricingPlan(plan({ offer_uuid: "offer_1", period: "lifetime" }), [{ ...offer, offer_type: "one_time" }], fmt);
    expect(r.period).toBe("lifetime");
    expect(r.billingInterval).toBeNull();
    expect(resolvePricingPlan(plan({ period: "/ mo" }), [offer], fmt).billingInterval).toBeNull();
  });

  test("loading shows no price; an offer missing from the listing drops the plan", () => {
    expect(resolvePricingPlan(plan({ offer_uuid: "offer_1" }), undefined, fmt)).toMatchObject({ loading: true, price: "" });
    expect(resolvePricingPlan(plan({ offer_uuid: "offer_gone" }), [offer], fmt)).toBeNull();
  });
});
