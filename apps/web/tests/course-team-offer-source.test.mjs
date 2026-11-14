// Contract test: a course sold only to teams (a company seat offer, whose
// carrier offer is unlisted) is still a paid course on its page. Before, the
// page only looked at listed offers and showed "Start course" to outsiders.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const actions = readFileSync(new URL("../components/Objects/Courses/CourseActions/CoursesActions.tsx", import.meta.url), "utf8");
const disclaimer = readFileSync(new URL("../ee/components/Payments/PaidCourseActivityDisclaimer.tsx", import.meta.url), "utf8");
const stub = readFileSync(new URL("../ee-stub/components/Companies/CourseTeamOffer.tsx", import.meta.url), "utf8");

describe("course page: team-only paid courses", () => {
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
