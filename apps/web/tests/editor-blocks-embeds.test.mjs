// User card, Web preview, H5P and Code playground after the block-interior redesign:
// the pure helpers, and backward compatibility of stored content against the REAL
// node definitions (every stored attr kept, new attrs at defaults, the view helpers
// resolving to what the old blocks rendered, and nothing lost through collab seeding).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment", "MutationObserver", "Range", "getComputedStyle"]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;

const { getSchema } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const Y = await import("yjs");
const { yXmlFragmentToProseMirrorRootNode } = await import("@tiptap/y-tiptap");
const server = await import("../../collab/src/prosemirrorY.ts");

const U = await import("../components/Objects/Editor/Extensions/Users/userCard.ts");
const W = await import("../components/Objects/Editor/Extensions/WebPreview/previewMeta.ts");
const H = await import("../components/Objects/Editor/Extensions/H5P/h5pChecks.ts");
const R = await import("../components/Objects/Editor/Extensions/CodePlayground/playground/runner.ts");
const { normalizeSizeMode, resolveManualHeight } = await import("../lib/media/h5pProtocol.ts");

const ext = (path) => import(`../components/Objects/Editor/Extensions/${path}`).then((m) => m.default);
const NODES = await Promise.all(["Users/UserBlock", "WebPreview/WebPreview", "H5P/H5PBlock", "CodePlayground/CodePlayground"].map(ext));
const schema = getSchema([StarterKit.configure({ codeBlock: false, link: false, undoRedo: false }), ...NODES]);
const legacy = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/embeds-legacy.json", import.meta.url), "utf8"));
const { _comment, ...legacyDoc } = legacy;

// Attrs added by this redesign, with the defaults old content must read as.
const NEW_ATTRS = {
  blockUser: { layout: "card" },
  blockWebPreview: { layout: "large", customTitle: null, customDescription: null },
  blockH5P: {},
  blockCode: { blockUuid: null },
};

describe("user card helpers", () => {
  test("layout defaults to the original card", () => {
    expect(U.userCardLayoutOf(undefined)).toBe("card");
    expect(U.userCardLayoutOf("card")).toBe("card");
    expect(U.userCardLayoutOf("compact")).toBe("compact");
    expect(U.userCardLayoutOf("weird")).toBe("card");
  });
  test("user ids: numbers and numeric strings, never blanks", () => {
    expect(U.userIdOf(79)).toBe("79");
    expect(U.userIdOf("12")).toBe("12");
    expect(U.userIdOf(" 12 ")).toBe("12");
    for (const v of ["", null, undefined, 0, -3, 1.5, "abc", "12a", {}]) expect(U.userIdOf(v)).toBeNull();
  });
  test("display name falls back to the username", () => {
    expect(U.displayName({ first_name: "Ada", last_name: "Lovelace", username: "ada" })).toBe("Ada Lovelace");
    expect(U.displayName({ first_name: " ", last_name: "", username: "ada" })).toBe("ada");
    expect(U.displayName(null)).toBe("");
  });
  test("member rows from /orgs/{id}/users", () => {
    const rows = U.memberOptionsFrom({
      items: [
        { user: { id: 7, user_uuid: "user_x", username: "lea", first_name: "Lea", last_name: "Fontaine", avatar_image: "a.png" }, role: { name: "Maintainer" } },
        { user: { id: "bad" } },
        null,
        { user: { id: 8, username: "pia" } },
      ],
    });
    expect(rows).toEqual([
      { id: 7, user_uuid: "user_x", username: "lea", name: "Lea Fontaine", avatar_image: "a.png", role: "Maintainer" },
      { id: 8, user_uuid: "", username: "pia", name: "pia", avatar_image: "", role: "" },
    ]);
    expect(U.memberOptionsFrom(null)).toEqual([]);
    expect(U.memberOptionsFrom({ items: "nope" })).toEqual([]);
  });
});

describe("web preview helpers", () => {
  test("layout and alignment default to the original card", () => {
    expect(W.previewLayoutOf(undefined)).toBe("large");
    expect(W.previewLayoutOf("compact")).toBe("compact");
    expect(W.previewAlignOf(undefined)).toBe("left");
    expect(W.previewAlignOf("center")).toBe("center");
    expect(W.previewAlignOf("right")).toBe("right");
    expect(W.previewAlignOf("justify")).toBe("left");
  });
  test("text: overrides win, the URL-as-title reads as the host", () => {
    expect(W.previewTextOf({ url: "https://www.learnhouse.app", title: "LearnHouse", description: "Open source" })).toEqual({ title: "LearnHouse", description: "Open source", host: "learnhouse.app" });
    expect(W.previewTextOf({ url: "https://a.dev/x", title: "Page", customTitle: "Mine", description: "d", customDescription: " Ours " })).toEqual({ title: "Mine", description: "Ours", host: "a.dev" });
    expect(W.previewTextOf({ url: "https://developer.mozilla.org/en-US/docs/Web/HTML", title: "https://developer.mozilla.org/en-US/docs/Web/HTML" }).title).toBe("developer.mozilla.org");
    expect(W.previewTextOf({ url: "https://example.com/a", title: null }).title).toBe("example.com");
    expect(W.previewTextOf({ url: "javascript:alert(1)", title: "x" }).host).toBe("");
  });
  test("metadata keeps only known, safe fields", () => {
    const meta = W.metadataAttrsFrom({ title: " T ", description: "", og_image: "javascript:alert(1)", favicon: "https://x.dev/f.ico", og_url: "data:text/html,hi", og_type: "website", extra: "dropped" });
    expect(meta).toEqual({ title: "T", description: null, og_image: null, favicon: "https://x.dev/f.ico", og_type: "website", og_url: null });
    expect(W.metadataAttrsFrom(null)).toEqual({ title: null, description: null, og_image: null, favicon: null, og_type: null, og_url: null });
    expect(W.isThinMetadata({ title: null, description: null, og_image: null })).toBe(true);
    expect(W.isThinMetadata({ title: "x", description: null, og_image: null })).toBe(false);
  });
  test("pasted links are normalized and must be http(s)", () => {
    expect(W.normalizePreviewUrl("learnhouse.app")).toBe("https://learnhouse.app/");
    expect(W.normalizePreviewUrl(" https://a.dev/x?y=1 ")).toBe("https://a.dev/x?y=1");
    for (const bad of ["", "hello", "javascript:alert(1)", "ftp://a.dev", "two words.com"]) expect(W.normalizePreviewUrl(bad)).toBeNull();
  });
});

describe("h5p checks", () => {
  test("frames the browser refuses", () => {
    expect(H.frameProblemFor("http://h5p.example.org/embed/1", "https://school.learnhouse.io")).toBe("mixed_content");
    expect(H.frameProblemFor("https://h5p.example.org/embed/1", "https://school.learnhouse.io")).toBeNull();
    expect(H.frameProblemFor("http://localhost:8080/h5p/embed/1", "https://school.learnhouse.io")).toBeNull();
    expect(H.frameProblemFor("http://h5p.example.org/embed/1", "http://localhost:3000")).toBeNull();
    expect(H.frameProblemFor("https://school.learnhouse.io/course/x", "https://school.learnhouse.io")).toBe("same_site");
    expect(H.frameProblemFor("", "https://a.dev")).toBeNull();
    expect(H.frameProblemFor("not a url", "https://a.dev")).toBeNull();
    expect(H.frameProblemFor("https://a.dev/embed", null)).toBeNull();
    expect(H.frameProblemFor("https://a.dev/embed", "garbage")).toBeNull();
  });
  test("embed-shaped URLs", () => {
    for (const ok of ["https://h5p.org/h5p/embed/712", "https://x.h5p.com/content/1/embed", "https://moodle.school/mod/hvp/embed.php?id=3", "https://wp.site/wp-admin/admin-ajax.php?action=h5p_embed&id=1", "https://h5p.site/node/4?embed=1"]) {
      expect(H.looksLikeH5PEmbed(ok)).toBe(true);
    }
    expect(H.looksLikeH5PEmbed("https://h5p.org/node/712")).toBe(false);
    expect(H.looksLikeH5PEmbed("nope")).toBe(false);
  });
  test("openable URL drops H5P.com's /embed only", () => {
    expect(H.openableH5PUrl("https://team.h5p.com/content/1291/embed")).toBe("https://team.h5p.com/content/1291");
    expect(H.openableH5PUrl("https://h5p.org/h5p/embed/712")).toBe("https://h5p.org/h5p/embed/712");
    expect(H.openableH5PUrl("garbage")).toBe("garbage");
  });
});

describe("code playground runner", () => {
  test("test cases normalize, keep hidden only when true, dedupe ids", () => {
    expect(R.normalizeTestCases(null)).toEqual([]);
    expect(R.normalizeTestCases([{ id: "a", label: "A", stdin: "1", expectedStdout: "2", hidden: true }, { id: "a", label: "B" }, null, "x", { hidden: "yes" }])).toEqual([
      { id: "a", label: "A", stdin: "1", expectedStdout: "2", hidden: true },
      { id: "a-2", label: "B", stdin: "", expectedStdout: "" },
      { id: "test-5", label: "Test 5", stdin: "", expectedStdout: "" },
    ]);
  });
  test("time limit is clamped for display only", () => {
    expect(R.clampTimeLimitMs(10000)).toBe(10000);
    expect(R.clampTimeLimitMs(60000)).toBe(60000);
    expect(R.clampTimeLimitMs(100)).toBe(1000);
    expect(R.clampTimeLimitMs(999999)).toBe(60000);
    expect(R.clampTimeLimitMs("x")).toBe(10000);
  });
  test("limits mirror the API and are checked before a run", () => {
    const tc = (i) => ({ id: String(i), label: "", stdin: "", expectedStdout: "" });
    expect(R.checkRun("print(1)", [], [])).toBeNull();
    expect(R.checkRun("x", Array.from({ length: 51 }, (_, i) => tc(i)), [])).toEqual({ kind: "too_many_tests", max: 50 });
    expect(R.checkRun("x".repeat(64 * 1024 + 1), [], [])).toEqual({ kind: "code_too_long", max: 65536 });
    expect(R.checkRun("x", [], [], "y".repeat(65537))).toEqual({ kind: "input_too_long", max: 65536 });
    expect(R.checkRun("x", [{ ...tc(1), expectedStdout: "y".repeat(65537) }], [])).toEqual({ kind: "input_too_long", max: 65536 });
    expect(R.checkRun("x", [], Array.from({ length: 21 }, () => ({ name: "a", content: "" })))).toEqual({ kind: "too_many_files", max: 20 });
    expect(R.checkRun("x", [], [{ name: "big.txt", content: "z".repeat(128 * 1024 + 1) }])).toEqual({ kind: "file_too_long", name: "big.txt", max: 131072 });
  });
  test("failed responses map to explainable errors", () => {
    expect(R.runErrorFrom(429, {})).toEqual({ kind: "rate_limited" });
    expect(R.runErrorFrom(503, {})).toEqual({ kind: "unavailable" });
    expect(R.runErrorFrom(401, {})).toEqual({ kind: "auth" });
    expect(R.runErrorFrom(400, { detail: "Invalid file path" })).toEqual({ kind: "rejected", message: "Invalid file path" });
    expect(R.runErrorFrom(422, { detail: [{ msg: "too long" }] })).toEqual({ kind: "rejected", message: "too long" });
    expect(R.runErrorFrom(500, null)).toEqual({ kind: "rejected", message: "" });
  });
  test("summary and hidden-test redaction", () => {
    const res = (id, passed, extra = {}) => ({ id, label: id, passed, actual_stdout: "out", expected_stdout: "exp", stderr: "err", compile_output: null, status: null, time: "0.01", memory: 1, ...extra });
    expect(R.summarize(null)).toBeNull();
    expect(R.summarize([res("a", true), res("b", false, { compile_output: "boom" })])).toEqual({ total: 2, passed: 1, allPassed: false, compileOutput: "boom" });
    expect(R.summarize([res("a", true)]).allPassed).toBe(true);
    expect(R.summarize([]).allPassed).toBe(false);
    const hidden = { id: "h", label: "H", stdin: "secret", expectedStdout: "answer", hidden: true };
    const learner = R.visibleResult(res("h", false), hidden, false);
    expect(learner).toMatchObject({ redacted: true, actual_stdout: null, expected_stdout: "", stderr: null, passed: false });
    expect(R.visibleResult(res("h", false), hidden, true).redacted).toBe(false);
    expect(R.visibleResult(res("v", false), { ...hidden, hidden: false }, false).expected_stdout).toBe("exp");
  });
  test("a language switch only replaces an untouched starter", () => {
    expect(R.shouldReplaceStarter("", "# Write your code here\n")).toBe(true);
    expect(R.shouldReplaceStarter("# Write your code here\n\n", "# Write your code here\n")).toBe(true);
    expect(R.shouldReplaceStarter("print(1)", "# Write your code here\n")).toBe(false);
    expect(R.shouldReplaceStarter("print(1)", undefined)).toBe(false);
  });
  test("requests: one run, a batch, and failures", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    try {
      globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        if (url.endsWith("code/execute")) return reply(200, { stdout: "hi\n", status: { id: 3, description: "Accepted" }, time: "0.02", memory: 3000 });
        return reply(200, { results: [{ id: "t1", passed: true }] });
      };
      const req = { apiUrl: "http://api/", token: "tok", activityUuid: "activity_1", languageId: 71, code: "print('hi')", files: [{ name: "a.txt", content: "1" }], sqliteDbPath: "orgs/x.db" };
      const one = await R.executeOnce(req, "in", "Output");
      expect(one.ok && one.results[0]).toMatchObject({ id: "single", passed: true, actual_stdout: "hi\n", expected_stdout: "" });
      expect(calls[0].body).toEqual({ activity_uuid: "activity_1", language_id: 71, source_code: "print('hi')", sqlite_db_path: "orgs/x.db", additional_files: [{ name: "a.txt", content: "1" }], stdin: "in" });
      const batch = await R.executeTests({ ...req, files: [], sqliteDbPath: undefined }, [{ id: "t1", label: "T", stdin: "1", expectedStdout: "2", hidden: true }]);
      expect(batch).toEqual({ ok: true, results: [{ id: "t1", passed: true }] });
      // Hidden is a display setting: the server gets the same test shape as always.
      expect(calls[1].body.test_cases).toEqual([{ id: "t1", label: "T", stdin: "1", expected_stdout: "2" }]);
      expect(calls[1].body.additional_files).toBeUndefined();

      globalThis.fetch = async () => reply(429, { detail: "Too many" });
      expect(await R.executeTests(req, [])).toEqual({ ok: false, error: { kind: "rate_limited" } });
      globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => { throw new Error("not json"); } });
      expect(await R.executeOnce(req, "", "x")).toEqual({ ok: false, error: { kind: "unavailable" } });
      globalThis.fetch = async () => { throw new Error("offline"); };
      expect(await R.executeOnce(req, "", "x")).toEqual({ ok: false, error: { kind: "network" } });
      expect(await R.executeTests(req, [])).toEqual({ ok: false, error: { kind: "network" } });
      globalThis.fetch = async () => reply(200, { nope: true });
      expect(await R.executeTests(req, [])).toEqual({ ok: false, error: { kind: "rejected", message: "" } });
      globalThis.fetch = async () => reply(200, null);
      const empty = await R.executeOnce(req, "", "x");
      expect(empty.ok && empty.results[0]).toMatchObject({ passed: false, actual_stdout: null, status: null });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("stored content loads unchanged through the real node definitions", () => {
  const doc = schema.nodeFromJSON(legacyDoc);
  const stored = legacyDoc.content;
  const loaded = doc.toJSON().content;

  test("every block parses and checks", () => {
    expect(() => doc.check()).not.toThrow();
    expect(loaded.length).toBe(stored.length);
  });

  test("stored attrs are kept and new attrs read as their defaults", () => {
    stored.forEach((node, i) => {
      const out = loaded[i];
      expect(out.type).toBe(node.type);
      for (const [k, v] of Object.entries(node.attrs || {})) expect(out.attrs[k]).toEqual(v);
      for (const [k, v] of Object.entries(NEW_ATTRS[node.type])) {
        if (!(k in (node.attrs || {}))) expect(out.attrs[k]).toEqual(v);
      }
    });
  });

  test("round trip is stable", () => {
    expect(schema.nodeFromJSON(doc.toJSON()).toJSON()).toEqual(doc.toJSON());
  });

  test("view helpers resolve to what the old blocks showed", () => {
    for (const n of loaded) {
      if (n.type === "blockUser") expect(U.userCardLayoutOf(n.attrs.layout)).toBe("card");
      if (n.type === "blockWebPreview") {
        expect(W.previewLayoutOf(n.attrs.layout)).toBe("large");
        if (n.attrs.title && n.attrs.title !== n.attrs.url) expect(W.previewTextOf(n.attrs).title).toBe(n.attrs.title);
        expect(W.previewTextOf(n.attrs).description).toBe(n.attrs.description || "");
        expect(W.previewAlignOf(n.attrs.alignment)).toBe(n.attrs.alignment || "left");
      }
      if (n.type === "blockH5P") {
        // Old blocks have no sizeMode and keep auto sizing at their stored height.
        expect(normalizeSizeMode(n.attrs.sizeMode)).toBe(n.attrs.sizeMode === "widescreen" ? "widescreen" : "auto");
        if (normalizeSizeMode(n.attrs.sizeMode) === "auto") expect(resolveManualHeight(n.attrs.sizeMode, 800, n.attrs.height)).toBeNull();
      }
      if (n.type === "blockCode") {
        const tests = R.normalizeTestCases(n.attrs.testCases);
        expect(tests.every((t) => !t.hidden)).toBe(true);
        expect(tests.map((t) => t.id)).toEqual((n.attrs.testCases || []).map((t) => t.id));
        expect(n.attrs.blockUuid).toBeNull();
      }
    }
  });

  test("user ids keep their stored type (number or string)", () => {
    expect(loaded[1].attrs.user_id).toBe(79);
    expect(loaded[2].attrs.user_id).toBe("12");
  });
});

describe("new attrs survive collab seeding", () => {
  test("hidden tests, overrides, layouts and block ids round-trip through the server's Yjs encoding", () => {
    const content = {
      type: "doc",
      content: [
        { type: "blockUser", attrs: { user_id: 5, layout: "compact" } },
        { type: "blockWebPreview", attrs: { url: "https://a.dev", title: "A", layout: "compact", customTitle: "Mine", customDescription: "Ours" } },
        { type: "blockH5P", attrs: { h5pUrl: "https://h5p.org/h5p/embed/1", sizeMode: "tall", height: 760 } },
        { type: "blockCode", attrs: { blockUuid: "b-1", testCases: [{ id: "t1", label: "T", stdin: "", expectedStdout: "1", hidden: true }] } },
      ],
    };
    const serverDoc = server.prosemirrorJSONToYDoc(content);
    const client = new Y.Doc();
    Y.applyUpdate(client, server.encodeUpdate(serverDoc));
    const node = yXmlFragmentToProseMirrorRootNode(client.getXmlFragment("default"), schema);
    expect(node.toJSON()).toEqual(schema.nodeFromJSON(server.normalizeActivityContent(content)).toJSON());
    const json = node.toJSON().content;
    expect(json[0].attrs.layout).toBe("compact");
    expect(json[1].attrs).toMatchObject({ layout: "compact", customTitle: "Mine", customDescription: "Ours" });
    expect(json[3].attrs.blockUuid).toBe("b-1");
    expect(json[3].attrs.testCases[0].hidden).toBe(true);
  });
});
