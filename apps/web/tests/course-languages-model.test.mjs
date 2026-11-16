import { describe, expect, test } from "bun:test";

const {
  UI_LOCALES,
  itemTranslationState,
  progressSummary,
  runningJobs,
  jobPercent,
  languageOptions,
  withLangParam,
  resolveEditingLocale,
  parseLearningItems,
  mergeLearningTexts,
  learningTextsById,
  cleanTranslatedSeo,
} = await import("../components/Dashboard/Pages/Course/EditCourseLanguages/courseLanguagesModel.ts");
const { normalizeLocale, localeName } = await import("../services/courses/translations.ts");
const { activityRoomName, withLocaleQuery, translationBanner, sourceDiffRange, docPlainText } = await import(
  "../components/Objects/Editor/Translation/translationEditorModel.ts"
);

const opts = (query, exclude = []) => ({
  query,
  exclude,
  displayLocale: "en",
  nameOf: (code, d) => localeName(code, d),
  normalize: (v) => normalizeLocale(v),
});

describe("course languages model", () => {
  test("22 UI locales", () => {
    expect(UI_LOCALES.length).toBe(22);
    expect(UI_LOCALES[0]).toBe("ar");
  });

  test("item translation state", () => {
    expect(itemTranslationState(null)).toBe("missing");
    expect(itemTranslationState({ outdated: true })).toBe("outdated");
    expect(itemTranslationState({ outdated: false })).toBe("translated");
  });

  test("progress summary clamps and computes percent", () => {
    expect(progressSummary({ activities_total: 40, activities_translated: 14, activities_outdated: 2 })).toEqual({
      total: 40,
      translated: 14,
      outdated: 2,
      percent: 35,
    });
    expect(progressSummary({ activities_total: 2, activities_translated: 5, activities_outdated: -1 }).translated).toBe(2);
    expect(progressSummary({ activities_total: 0, activities_translated: 0, activities_outdated: 0, course_translated: true }).percent).toBe(100);
    expect(progressSummary(null).percent).toBe(0);
  });

  test("running jobs and percent", () => {
    const jobs = [
      { locale: "fr", state: "running", done: 14, total: 40 },
      { locale: "de", state: "done", done: 3, total: 3 },
      { locale: "de", state: "running", done: 0, total: 0 },
    ];
    expect(runningJobs(jobs).length).toBe(2);
    expect(runningJobs(jobs, "fr").length).toBe(1);
    expect(runningJobs(undefined)).toEqual([]);
    expect(jobPercent(jobs[0])).toBe(35);
    expect(jobPercent(jobs[2])).toBe(0);
  });

  test("language options: UI locales first, exclusions, free codes", () => {
    const all = languageOptions(opts(""));
    expect(all.map((o) => o.code)).toEqual([...UI_LOCALES]);
    const noFr = languageOptions(opts("", ["fr", "en"]));
    expect(noFr.find((o) => o.code === "fr")).toBeUndefined();
    expect(noFr.length).toBe(20);
    const german = languageOptions(opts("germ"));
    expect(german[0].code).toBe("de");
    const swedish = languageOptions(opts("swed"));
    expect(swedish.some((o) => o.code === "sv")).toBe(true);
    const brazil = languageOptions(opts("pt-br"));
    expect(brazil.some((o) => o.code === "pt-BR")).toBe(true);
    // a valid unlisted code is offered as typed (normalized)
    const typed = languageOptions(opts("gsw"));
    expect(typed.some((o) => o.code === "gsw")).toBe(true);
    // native names
    expect(all.find((o) => o.code === "fr").native.toLowerCase()).toBe("français");
  });

  test("lang URL param", () => {
    expect(withLangParam("/dash/courses/course/x/general", "fr")).toBe("/dash/courses/course/x/general?lang=fr");
    expect(withLangParam("/a?section=b&lang=de#top", "fr")).toBe("/a?section=b&lang=fr#top");
    expect(withLangParam("/a?lang=fr", null)).toBe("/a");
    expect(withLangParam("/a?x=1&lang=fr", null)).toBe("/a?x=1");
  });

  test("editing locale only for a course language other than the default", () => {
    const n = (v) => normalizeLocale(v);
    expect(resolveEditingLocale("fr", ["fr", "de"], "en", n)).toBe("fr");
    expect(resolveEditingLocale("pt_br", ["pt-BR"], "en", n)).toBe("pt-BR");
    expect(resolveEditingLocale("en", ["fr"], "en", n)).toBe(null);
    expect(resolveEditingLocale("it", ["fr"], "en", n)).toBe(null);
    expect(resolveEditingLocale("fr", null, "en", n)).toBe("fr");
    expect(resolveEditingLocale(null, ["fr"], "en", n)).toBe(null);
    expect(resolveEditingLocale("!!", ["fr"], "en", n)).toBe(null);
  });

  test("learnings keep the source shape", () => {
    const source = parseLearningItems(JSON.stringify([{ id: "a", text: "Cats", emoji: "🐱" }, { id: "b", text: "Dogs", link: "https://x" }]));
    const translated = learningTextsById(source, JSON.stringify([{ id: "b", text: "Chiens" }]));
    expect(translated).toEqual({ a: "", b: "Chiens" });
    // by position when ids differ
    expect(learningTextsById(source, JSON.stringify([{ id: "x", text: "Chats" }]))).toEqual({ a: "Chats", b: "" });
    const merged = JSON.parse(mergeLearningTexts(source, { a: "Chats", b: "Chiens" }));
    expect(merged).toEqual([{ id: "a", text: "Chats", emoji: "🐱" }, { id: "b", text: "Chiens", link: "https://x" }]);
    expect(parseLearningItems("plain")).toEqual([{ id: "l_0", text: "plain" }]);
    expect(parseLearningItems(null)).toEqual([]);
  });

  test("translated SEO keeps only text fields with values", () => {
    expect(
      cleanTranslatedSeo({ title: "T", description: "  ", robots_noindex: true, faq: [{ question: "Q", answer: "" }, { question: "", answer: " " }] }),
    ).toEqual({ title: "T", faq: [{ question: "Q", answer: "" }] });
    expect(cleanTranslatedSeo(null)).toEqual({});
  });
});

describe("activity translation editor model", () => {
  test("room names", () => {
    expect(activityRoomName("activity_1")).toBe("activity:activity_1");
    expect(activityRoomName("activity_1", null)).toBe("activity:activity_1");
    expect(activityRoomName("activity_1", "pt-BR")).toBe("activity:activity_1:pt-BR");
  });

  test("locale query", () => {
    expect(withLocaleQuery("/a", null)).toBe("/a");
    expect(withLocaleQuery("/a", "fr")).toBe("/a?locale=fr");
    expect(withLocaleQuery("/a?q=1", "zh-Hans")).toBe("/a?q=1&locale=zh-Hans");
  });

  test("banner and diff range", () => {
    expect(translationBanner({ outdated: true })).toBe("outdated");
    expect(translationBanner(null)).toBe("none");
    expect(sourceDiffRange({ source_version: 3, current_source_version: 5 })).toEqual({ from: 3, to: 5 });
    expect(sourceDiffRange({ source_version: 5, current_source_version: 5 })).toBe(null);
    expect(sourceDiffRange({ source_version: null, current_source_version: 5 })).toBe(null);
  });

  test("plain text of a document", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "bold" }] }] },
        { type: "blockquoteCustom", content: [{ type: "paragraph", content: [{ type: "text", text: "Inner" }] }] },
        { type: "imageBlock", attrs: { alt: "A cat" } },
        { type: "paragraph" },
      ],
    };
    expect(docPlainText(doc)).toBe("Title\nHello world\nInner\nA cat");
    expect(docPlainText(null)).toBe("");
  });
});
