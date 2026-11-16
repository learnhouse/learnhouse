// Contract test: a course sold only to teams (a company seat offer, whose
// carrier offer is unlisted) is still a paid course on its page. Before, the
// page only looked at listed offers and showed "Start course" to outsiders.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const actions = readFileSync(new URL("../components/Objects/Courses/CourseActions/CoursesActions.tsx", import.meta.url), "utf8");
// EE sources ship only with the Enterprise Edition; the EE CI runs these.
const DISCLAIMER = new URL("../ee/components/Payments/PaidCourseActivityDisclaimer.tsx", import.meta.url);
const HAS_EE = existsSync(DISCLAIMER);
const disclaimer = HAS_EE ? readFileSync(DISCLAIMER, "utf8") : "";
const stub = readFileSync(new URL("../ee-stub/components/Companies/CourseTeamOffer.tsx", import.meta.url), "utf8");

describe.skipIf(!HAS_EE)("course page: team-only paid courses", () => {
  test("team offers count as selling the course", () => {
    expect(actions).toContain("useTeamSeatOffers(");
    expect(actions).toMatch(/const isSold = linkedOffers\.length > 0 \|\| teamOffers\.length > 0/);
  });

  test("the paywall check and the offers branch use isSold", () => {
    expect(actions).toMatch(/enabled: [^\n]*&& isSold,/);
    expect(actions).toMatch(/if \(isSold && !\(hasPaidAccess && !isStarted\)\)/);
  });

  test("outsiders get the team call to action, on the course and on a locked lesson", () => {
    expect(actions).toContain("<CourseTeamOffer");
    expect(disclaimer).toContain("<TeamSeatsCard");
  });

  test("the OSS build has no team offers", () => {
    expect(stub).toContain("return []");
    expect(stub).toContain("return null");
  });
});
