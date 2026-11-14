// Tab titles for the company pages (their pages are client components, so the
// route files re-export these generateMetadata helpers). Private pages are
// noindex; the team storefront is indexable and uses the seat offer's name.
import { beforeEach, describe, expect, test } from "bun:test";

const org = { id: 7, name: "Kitebase Academy" };
let seatOffer = null;
let space = null;
let token = "tok";
const { makeCompanyMetadata } = await import("../ee/app/companies/metadataCore.ts");
const m = makeCompanyMetadata({
  getOrg: async () => org,
  title: (page, o) => `${page} | ${o.name}`,
  getToken: async () => token,
  getPublicSeatOffer: async () => seatOffer,
  getCompanySpace: async () => space,
});
const params = (extra = {}) => ({ params: Promise.resolve({ orgslug: "kite", ...extra }) });

beforeEach(() => {
  seatOffer = null;
  space = null;
  token = "tok";
});

describe("company page metadata", () => {
  test("team portal: titled and private", async () => {
    const meta = await m.teamPortalMetadata(params());
    expect(String(meta.title)).toContain("Team");
    expect(String(meta.title)).toContain("Kitebase Academy");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  test("join page: titled and private", async () => {
    const meta = await m.teamJoinMetadata(params());
    expect(String(meta.title)).toContain("Join your team");
    expect(meta.robots.index).toBe(false);
  });

  test("team storefront: the seat offer's name, indexable", async () => {
    seatOffer = { success: true, data: { name: "Team access" } };
    const meta = await m.teamPurchaseMetadata(params({ seatofferuuid: "seatoffer_1" }));
    expect(String(meta.title)).toContain("Team access");
    expect(meta.robots.index).toBe(true);
  });

  test("team storefront: generic title when the offer is missing", async () => {
    seatOffer = { success: false, data: { detail: "Not Found" } };
    const meta = await m.teamPurchaseMetadata(params({ seatofferuuid: "nope" }));
    expect(String(meta.title)).toContain("Buy for your team");
  });

  test("company space: the company's name for members, generic otherwise, always private", async () => {
    space = { success: true, data: { company: { name: "Acme" } } };
    const member = await m.companySpaceMetadata(params({ slug: "acme" }));
    expect(String(member.title)).toContain("Acme");
    expect(member.robots.index).toBe(false);
    token = null;
    const signedOut = await m.companySpaceMetadata(params({ slug: "acme" }));
    expect(String(signedOut.title)).toContain("Company space");
  });
});
