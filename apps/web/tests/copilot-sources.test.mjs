import { describe, expect, test } from "bun:test";

import {
  formatTimestamp,
  positiveIntParam,
  sourceLocation,
  sourcePath,
  sourceTitle,
} from "../lib/copilot/sources.ts";

const video = {
  source_type: "video",
  course_uuid: "course_abc",
  activity_uuid: "activity_def",
  activity_name: "Lecture",
  locator: { start: 192.7 },
};

describe("sourcePath", () => {
  test("opens a video at the cited moment", () => {
    expect(sourcePath(video)).toBe("/course/abc/activity/def?t=192");
  });

  test("opens a document at the cited page", () => {
    expect(sourcePath({ ...video, locator: { page: 4 } })).toBe("/course/abc/activity/def?page=4");
  });

  test("course and chapter text open the course page", () => {
    expect(sourcePath({ course_uuid: "course_abc", activity_uuid: null, source_type: "chapter" })).toBe("/course/abc");
    expect(sourcePath({ course_uuid: "course_abc", activity_uuid: "" })).toBe("/course/abc");
  });

  test("history saved before locators still links to the activity", () => {
    expect(sourcePath({ course_uuid: "course_abc", activity_uuid: "activity_def", activity_name: "Old" }))
      .toBe("/course/abc/activity/def");
  });

  test("no course, no link", () => {
    expect(sourcePath({ activity_uuid: "activity_def" })).toBeNull();
  });
});

describe("sourceLocation", () => {
  test("time and page", () => {
    expect(sourceLocation(video)).toEqual({ kind: "time", seconds: 192, label: "03:12" });
    expect(sourceLocation({ locator: { page: 2 } })).toEqual({ kind: "page", page: 2, label: "2" });
  });

  test("ignores missing or malformed locators", () => {
    expect(sourceLocation({})).toBeNull();
    expect(sourceLocation({ locator: null })).toBeNull();
    expect(sourceLocation({ locator: { page: 0 } })).toBeNull();
    expect(sourceLocation({ locator: { page: 1.5 } })).toBeNull();
    expect(sourceLocation({ locator: { start: Number.NaN } })).toBeNull();
  });
});

describe("sourceTitle", () => {
  test("falls back from activity to chapter to course", () => {
    expect(sourceTitle({ title: "T", activity_name: "A" })).toBe("T");
    expect(sourceTitle({ activity_name: "A", course_name: "C" })).toBe("A");
    expect(sourceTitle({ chapter_name: "Week 1", course_name: "C" })).toBe("Week 1");
    expect(sourceTitle({ course_name: "C" })).toBe("C");
    expect(sourceTitle({})).toBe("");
  });
});

describe("formatTimestamp", () => {
  test("minutes and hours", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(75)).toBe("01:15");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(-5)).toBe("00:00");
  });
});

describe("positiveIntParam", () => {
  test("accepts only positive integers", () => {
    expect(positiveIntParam("?t=192", "t")).toBe(192);
    expect(positiveIntParam("?page=3&x=1", "page")).toBe(3);
    for (const bad of ["", "?t=", "?t=0", "?t=-4", "?t=1.5", "?t=abc", "?t=1e3"]) {
      expect(positiveIntParam(bad, "t")).toBeNull();
    }
  });
});
