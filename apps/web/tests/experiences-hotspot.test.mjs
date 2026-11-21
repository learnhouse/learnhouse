import { describe, expect, test } from "bun:test";
import {
  addSpot,
  clamp,
  defaultHotspotContent,
  distanceTo,
  hitTest,
  isComplete,
  missHint,
  moveSpot,
  normalizeMode,
  normalizeSpots,
  nudgeSpot,
  pointToPercent,
  removeSpot,
  starsForMisses,
  targetSpots,
  updateSpot,
  validateHotspot,
  MAX_SPOTS,
  MIN_RADIUS,
  MAX_RADIUS,
} from "../components/Objects/Editor/Extensions/Experiences/Hotspot/hotspotModel.ts";

const spot = (id, x, y, r = 5, extra = {}) => ({ id, x, y, r, label: id, explanation: "", correct: true, ...extra });

describe("hotspot model", () => {
  test("clamp handles NaN and bounds", () => {
    expect(clamp(NaN, 0, 100)).toBe(0);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(42, 0, 100)).toBe(42);
  });

  test("normalizeSpots sanitises junk and dedupes ids", () => {
    const out = normalizeSpots([
      { id: "a", x: 120, y: -3, r: 100, label: "A" },
      { id: "a", x: "50", y: "50", r: 0 },
      null,
      "nope",
      { x: 10, y: 10, correct: false },
    ]);
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({ id: "a", x: 100, y: 0, r: MAX_RADIUS, label: "A", correct: true });
    expect(out[1].id).not.toBe("a");
    expect(out[1]).toMatchObject({ x: 50, y: 50, r: MIN_RADIUS, label: "" });
    expect(out[2].correct).toBe(false);
    expect(normalizeSpots("x")).toEqual([]);
    expect(normalizeSpots(Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, x: 1, y: 1 }))).length).toBe(MAX_SPOTS);
  });

  test("normalizeMode defaults to find", () => {
    expect(normalizeMode("explore")).toBe("explore");
    expect(normalizeMode("other")).toBe("find");
    expect(normalizeMode(undefined)).toBe("find");
  });

  test("hitTest respects radius and aspect ratio", () => {
    const spots = [spot("a", 50, 50, 10)];
    expect(hitTest(spots, 55, 50)?.id).toBe("a");
    expect(hitTest(spots, 61, 50)).toBeNull();
    // On a wide image (aspect 0.5) 18% of height is only 9% of width.
    expect(hitTest(spots, 50, 68, 0.5)?.id).toBe("a");
    expect(hitTest(spots, 50, 68, 1)).toBeNull();
    expect(distanceTo(spots[0], 50, 50)).toBe(0);
  });

  test("hitTest picks the closest of overlapping spots and skips found ones", () => {
    const spots = [spot("a", 40, 50, 15), spot("b", 50, 50, 15)];
    expect(hitTest(spots, 48, 50)?.id).toBe("b");
    expect(hitTest(spots, 42, 50)?.id).toBe("a");
    expect(hitTest(spots, 48, 50, 1, new Set(["b"]))?.id).toBe("a");
  });

  test("missHint says close near an unfound target", () => {
    const spots = [spot("a", 50, 50, 5)];
    expect(missHint(spots, new Set(), 58, 50)).toBe("close");
    expect(missHint(spots, new Set(), 90, 90)).toBe("far");
    expect(missHint(spots, new Set(["a"]), 58, 50)).toBe("far");
  });

  test("targets and completion", () => {
    const spots = [spot("a", 1, 1), spot("b", 2, 2, 5, { correct: false })];
    expect(targetSpots(spots).map((s) => s.id)).toEqual(["a"]);
    expect(isComplete(spots, new Set())).toBe(false);
    expect(isComplete(spots, new Set(["a"]))).toBe(true);
    expect(isComplete([], new Set())).toBe(false);
  });

  test("stars come from misses", () => {
    expect(starsForMisses(0, 4)).toBe(3);
    expect(starsForMisses(1, 4)).toBe(2);
    expect(starsForMisses(2, 4)).toBe(2);
    expect(starsForMisses(3, 4)).toBe(1);
    expect(starsForMisses(1, 1)).toBe(2);
    expect(starsForMisses(0, 0)).toBe(0);
  });

  test("add, move, nudge, update and remove spots", () => {
    let spots = addSpot([], 120, 30, "x");
    expect(spots.length).toBe(1);
    expect(spots[0]).toMatchObject({ x: 100, y: 30, label: "x", correct: true });
    const id = spots[0].id;
    spots = moveSpot(spots, id, 10.123, -4);
    expect(spots[0]).toMatchObject({ x: 10.12, y: 0 });
    spots = nudgeSpot(spots, id, 1, 2);
    expect(spots[0]).toMatchObject({ x: 11.12, y: 2 });
    expect(nudgeSpot(spots, "missing", 1, 1)).toBe(spots);
    spots = updateSpot(spots, id, { r: 999, label: "y" });
    expect(spots[0]).toMatchObject({ r: MAX_RADIUS, label: "y" });
    expect(removeSpot(spots, id)).toEqual([]);
    const full = Array.from({ length: MAX_SPOTS }, (_, i) => spot(`s${i}`, 1, 1));
    expect(addSpot(full, 5, 5)).toBe(full);
  });

  test("pointToPercent maps client coords", () => {
    expect(pointToPercent(150, 100, { left: 100, top: 50, width: 200, height: 100 })).toEqual({ x: 25, y: 50 });
    expect(pointToPercent(0, 0, { left: 100, top: 50, width: 200, height: 100 })).toEqual({ x: 0, y: 0 });
    expect(pointToPercent(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 50, y: 50 });
  });

  test("validation hints", () => {
    const kinds = (a) => validateHotspot(a).map((i) => i.kind);
    expect(kinds({ imageUrl: "", spots: [] })).toEqual(["noImage", "noSpots"]);
    expect(kinds({ imageUrl: "x.png", spots: [spot("a", 10, 10), { ...spot("b", 80, 80), label: " " }] })).toEqual(["missingLabel"]);
    expect(kinds({ imageUrl: "x.png", spots: [spot("a", 10, 10, 10), spot("b", 12, 10, 10)] })).toEqual(["overlap"]);
  });

  test("default content is translated and playable", () => {
    const content = defaultHotspotContent((k) => `T:${k}`);
    expect(content.title).toBe("T:editor.experiences.hotspot.example.title");
    expect(content.mode).toBe("find");
    expect(content.spots.length).toBe(2);
    expect(validateHotspot(content).map((i) => i.kind)).toEqual(["noImage"]);
  });
});
